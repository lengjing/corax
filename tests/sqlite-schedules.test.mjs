import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "./support/test.mjs";
import { Database } from "bun:sqlite";
import {
  sqliteScheduleProvider,
  pumpSqliteSchedules,
  readSqliteSchedulePath,
} from "../packages/corax/src/public/schedules/providers/sqlite.ts";
import { defineDynamicSchedules } from "../packages/corax/src/public/schedules/subscription.ts";
import { normalizeScheduleCollectionDefinition } from "../packages/corax/src/internal/authored-definition/schedule-collection.ts";

const execute = promisify(execFile);
const moduleURL = new URL(
  "../packages/corax/src/public/schedules/providers/sqlite.ts",
  import.meta.url,
).href;
const signal = new AbortController().signal;
function context(operationId, application = "test-agent") {
  return {
    operationId,
    abortSignal: signal,
    collection: "reminders",
    namespace: `users/${application}/alice`,
    target: { key: application },
  };
}
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "corax-schedules-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "schedules.sqlite");
  return { path, provider: sqliteScheduleProvider({ path }), now: Date.now() };
}
function pump(path, at, deliver, application = "test-agent") {
  return pumpSqliteSchedules({
    path,
    application,
    collection: "reminders",
    at: new Date(at),
    signal,
    deliver,
  });
}

test("the public dynamic-schedule default persists locally and rejects hosted-only definitions", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "corax-schedules-"));
  const previousCwd = process.cwd();
  process.chdir(root);
  t.after(async () => {
    process.chdir(previousCwd);
    await rm(root, { recursive: true, force: true });
  });
  const path = join(root, ".corax", "schedules.sqlite");
  const now = Date.now();
  const definition = defineDynamicSchedules({
    inputSchema: { "~standard": { version: 1, vendor: "test", validate: (value) => ({ value }) } },
    auth: () => null,
    async run() {},
  });
  const normalized = normalizeScheduleCollectionDefinition(definition, "Invalid schedule.");
  assert.equal(readSqliteSchedulePath(normalized.provider), path);
  await normalized.provider.create(context("create"), {
    name: "default",
    expression: { type: "single", at: new Date(now + 60_000).toISOString() },
    payload: { local: true },
  });
  await normalized.provider.invoke(context("invoke"), "default");
  const delivered = [];
  await pump(path, now + 1000, async (item) => {
    delivered.push(item);
  });
  assert.deepEqual(
    delivered.map(({ payload }) => payload),
    [{ local: true }],
  );
  const hosted = defineDynamicSchedules({
    ...definition,
    provider: { ...normalized.provider, kind: "vercel" },
  });
  assert.throws(
    () => normalizeScheduleCollectionDefinition(hosted, "Invalid schedule."),
    /Use the default SQLite provider/,
  );
});

test("schedule creation and manual invocation remain idempotent across restarts", async (t) => {
  const { path, provider, now } = await setup(t);
  const input = {
    name: "later",
    expression: { type: "single", at: new Date(now + 60_000).toISOString() },
    payload: { text: "hello" },
  };
  const original = await provider.create(context("create"), input);
  const reopened = sqliteScheduleProvider({ path });
  assert.deepEqual(await reopened.create(context("create"), input), original);
  await provider.disable(context("disable"), "later");
  await reopened.invoke(context("invoke"), "later");
  await reopened.invoke(context("invoke"), "later");
  const delivered = [];
  await pump(path, now + 1000, async (item) => {
    delivered.push(item);
  });
  await pump(path, now + 2000, async (item) => {
    delivered.push(item);
  });
  assert.equal(delivered.length, 1);
  assert.deepEqual(delivered[0].payload, { text: "hello" });
  assert.equal((await reopened.list(context("list"), {})).data.length, 1);
});

test("a failed occurrence retries with its original identity without repeating completed work", async (t) => {
  const { path, provider, now } = await setup(t);
  await provider.create(context("create"), {
    name: "once",
    expression: { type: "single", at: new Date(now + 100).toISOString() },
    payload: {},
  });
  const attempts = [];
  await pump(path, now + 1000, async ({ occurrence }) => {
    attempts.push(occurrence.executionId);
    throw new Error("transient");
  });
  await pump(path, now + 4000, async ({ occurrence }) => {
    attempts.push(occurrence.executionId);
  });
  await pump(path, now + 8000, async ({ occurrence }) => {
    attempts.push(occurrence.executionId);
  });
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0], attempts[1]);
  assert.equal((await provider.get(context("get"), "once")).state, "completed");
});

test("a worker crash releases its occurrence after the lease without losing its identity", async (t) => {
  const { path, provider, now } = await setup(t);
  await provider.create(context("create"), {
    name: "recover",
    expression: { type: "single", at: new Date(now + 100).toISOString() },
    payload: {},
  });
  const script = `import {pumpSqliteSchedules} from ${JSON.stringify(moduleURL)};
import {writeSync} from 'node:fs';
await pumpSqliteSchedules({path:process.argv[1],application:'test-agent',collection:'reminders',at:new Date(Number(process.argv[2])),signal:new AbortController().signal,deliver:async ({occurrence})=>{writeSync(1,occurrence.executionId);process.exit(0);}});`;
  const crashed = await execute(
    process.execPath,
    ["--no-env-file", "--conditions=corax-source", "-e", script, path, String(now + 1000)],
    { timeout: 10_000 },
  );
  assert.match(crashed.stdout, /^[a-f0-9-]{36}$/);
  const recovered = [];
  await pump(path, now + 6 * 60_000, async (item) => {
    recovered.push(item);
  });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].occurrence.executionId, crashed.stdout);
});

test("cron scheduling persists and one application cannot claim another application's jobs", async (t) => {
  const { path, provider, now } = await setup(t);
  for (const application of ["test-agent", "other-agent"]) {
    await provider.create(context("create", application), {
      name: "cron",
      expression: { type: "cron", cron: "* * * * *", timezone: "Asia/Shanghai" },
      payload: { application },
    });
  }
  const delivered = [];
  const at = Math.ceil(now / 60_000) * 60_000 + 1;
  await pump(path, at, async (item) => {
    delivered.push(item);
  });
  await pump(path, at + 60_000, async (item) => {
    delivered.push(item);
  });
  assert.equal(delivered.length, 2);
  assert.ok(delivered.every(({ payload }) => payload.application === "test-agent"));
  assert.equal(
    Date.parse(delivered[1].occurrence.scheduledAt) -
      Date.parse(delivered[0].occurrence.scheduledAt),
    60_000,
  );
  await provider.delete(context("delete"), "cron");
  await pump(path, at + 120_000, async () => assert.fail("deleted cron fired"));
  assert.equal(await provider.get(context("get"), "cron"), null);
});

test("a payload-only update preserves an overdue cron occurrence instead of skipping it", async (t) => {
  const { path, provider } = await setup(t);
  const base = Math.floor(Date.now() / 60_000) * 60_000 + 1000;
  const clock = t.mock.method(Date, "now", () => base);
  await provider.create(context("create"), {
    name: "overdue",
    expression: { type: "cron", cron: "* * * * *" },
    payload: { revision: "old" },
  });
  clock.mock.mockImplementation(() => base + 90_000);
  await provider.update(context("update"), "overdue", { payload: { revision: "new" } });
  const delivered = [];
  await pump(path, base + 90_000, async (item) => {
    delivered.push(item);
  });
  assert.equal(delivered.length, 1);
  assert.deepEqual(delivered[0].payload, { revision: "new" });
  assert.equal(Date.parse(delivered[0].occurrence.scheduledAt), base - 1000 + 60_000);
});

test(
  "100/minute drains bounded batches without growing backlog over two simulated hours",
  { timeout: 300_000 },
  async (t) => {
    const { path, provider } = await setup(t);
    const base = Date.parse("2030-01-01T00:00:00Z");
    t.mock.method(Date, "now", () => base);
    for (let i = 0; i < 100; i++)
      await provider.create(context(`create-${i}`), {
        name: `cron-${i}`,
        expression: { type: "cron", cron: "* * * * *" },
        payload: {},
      });
    const ids = new Set();
    for (let minute = 1; minute <= 120; minute++) {
      let rounds = 0;
      let more;
      do {
        const before = ids.size;
        more = await pump(path, base + minute * 60_000, async ({ occurrence }) => {
          assert.ok(!ids.has(occurrence.executionId));
          ids.add(occurrence.executionId);
        });
        assert.ok(ids.size - before <= 16);
        assert.ok(++rounds <= 7, "backlog must converge promptly");
      } while (more);
      assert.equal(ids.size, minute * 100);
    }
    const db = new Database(path);
    try {
      assert.equal(
        db.query("SELECT count(*) AS n FROM schedule_occurrences WHERE state != 'done'").get().n,
        0,
      );
    } finally {
      db.close(true);
    }
  },
);

test("exhausted leases notify durably, retry notification failures and stop after success or budget", async (t) => {
  const { path, provider, now } = await setup(t);
  for (const name of ["recover", "exhaust"]) {
    await provider.create(context(`create-${name}`), {
      name,
      expression: { type: "single", at: new Date(now + 60_000).toISOString() },
      payload: {},
    });
    await provider.invoke(context(`invoke-${name}`), name);
  }
  const db = new Database(path);
  try {
    db.query(
      "UPDATE schedule_occurrences SET state = 'running', attempts = 10, leaseUntil = ?, leaseToken = 'dead'",
    ).run(now);
  } finally {
    db.close(true);
  }
  const seen = new Map();
  const run = (at) =>
    pumpSqliteSchedules({
      path,
      application: "test-agent",
      collection: "reminders",
      at: new Date(at),
      signal,
      deliver: async () => assert.fail("exhausted delivery retried"),
      onFailure: async ({ occurrence }) => {
        const count = (seen.get(occurrence.name) ?? 0) + 1;
        seen.set(occurrence.name, count);
        if (occurrence.name === "exhaust" || count === 1)
          throw new Error("notification unavailable");
      },
    });
  await provider.disable(context("disable-recover"), "recover");
  await provider.disable(context("disable-exhaust"), "exhaust");
  for (let i = 0; i < 20; i++) await run(now + i * 60_000);
  assert.equal(seen.get("recover"), 2);
  assert.equal(seen.get("exhaust"), 10);
  const check = new Database(path);
  try {
    assert.equal(
      check.query("SELECT count(*) AS n FROM schedule_occurrences WHERE state = 'failed'").get().n,
      2,
    );
    assert.equal(
      check
        .query("SELECT count(*) AS n FROM schedule_failure_notifications WHERE delivered = 1")
        .get().n,
      1,
    );
  } finally {
    check.close(true);
  }
});

test("single cron inputs are rejected and cancelling a batch prevents further claims", async (t) => {
  const { path, provider, now } = await setup(t);
  await assert.rejects(
    provider.create(context("invalid"), {
      name: "invalid",
      expression: { type: "single", at: "* * * * *" },
      payload: {},
    }),
    /valid date/,
  );
  for (let i = 0; i < 3; i++) {
    await provider.create(context(`create-${i}`), {
      name: `job-${i}`,
      expression: { type: "single", at: new Date(now + 60_000).toISOString() },
      payload: {},
    });
    await provider.invoke(context(`invoke-${i}`), `job-${i}`);
  }
  const abort = new AbortController();
  let calls = 0;
  await pumpSqliteSchedules({
    path,
    application: "test-agent",
    collection: "reminders",
    at: new Date(now + 1000),
    signal: abort.signal,
    deliver: async () => {
      calls++;
      abort.abort();
    },
  });
  assert.equal(calls, 1);
  await provider.delete(context("delete"), "job-1");
  await pump(path, now + 2000, async ({ occurrence }) => {
    assert.equal(occurrence.name, "job-2");
    calls++;
  });
  assert.equal(calls, 2);
});

test("a slow failure notification backs off from completion, not invocation", async (t) => {
  const { path, provider, now } = await setup(t);
  let clock = now;
  t.mock.method(Date, "now", () => clock);
  await provider.create(context("slow-create"), {
    name: "slow",
    expression: { type: "single", at: new Date(now + 60_000).toISOString() },
    payload: {},
  });
  await provider.invoke(context("slow-invoke"), "slow");
  const db = new Database(path);
  try {
    db.query("UPDATE schedule_occurrences SET state = 'failed', attempts = 10").run();
  } finally {
    db.close(true);
  }
  let calls = 0;
  const poll = () =>
    pumpSqliteSchedules({
      path,
      application: "test-agent",
      collection: "reminders",
      at: new Date(clock),
      signal,
      deliver: async () => assert.fail("exhausted job must not be delivered"),
      onFailure: async () => {
        calls++;
        if (calls === 1) {
          clock += 5000;
          throw new Error("slow notification failed");
        }
      },
    });
  await poll();
  assert.equal(calls, 1);
  const check = new Database(path);
  try {
    assert.equal(
      check.query("SELECT retryAt FROM schedule_failure_notifications").get().retryAt,
      clock + 2000,
    );
  } finally {
    check.close(true);
  }
  await poll();
  assert.equal(calls, 1, "failure must not consume its own backoff");
  clock += 1999;
  await poll();
  assert.equal(calls, 1);
  clock += 1;
  await poll();
  assert.equal(calls, 2);
  await poll();
  assert.equal(calls, 2, "successful notification must not be repeated");
});

test("a crashed notification worker resumes with the same execution ID after its lease", async (t) => {
  const { path, provider, now } = await setup(t);
  await provider.create(context("create"), {
    name: "notice",
    expression: { type: "single", at: new Date(now + 60_000).toISOString() },
    payload: {},
  });
  await provider.invoke(context("invoke"), "notice");
  await provider.disable(context("disable"), "notice");
  const db = new Database(path);
  try {
    db.query(
      "UPDATE schedule_occurrences SET state = 'running', attempts = 10, leaseUntil = ?",
    ).run(now);
  } finally {
    db.close(true);
  }
  const script = `import {pumpSqliteSchedules} from ${JSON.stringify(moduleURL)};
    import {writeSync} from 'node:fs';
    await pumpSqliteSchedules({path:process.argv[1],application:'test-agent',collection:'reminders',at:new Date(Number(process.argv[2])),signal:new AbortController().signal,
      deliver:async()=>{throw new Error('must not deliver')},onFailure:async({occurrence})=>{writeSync(1,occurrence.executionId);process.exit(0)}});`;
  const crashed = await execute(process.execPath, ["-e", script, path, String(now)], {
    timeout: 10_000,
  });
  assert.match(crashed.stdout, /^[a-f0-9-]{36}$/);
  const notices = [];
  const run = (at) =>
    pumpSqliteSchedules({
      path,
      application: "test-agent",
      collection: "reminders",
      at: new Date(at),
      signal,
      deliver: async () => assert.fail("exhausted occurrence delivered"),
      onFailure: async ({ occurrence }) => {
        notices.push(occurrence.executionId);
      },
    });
  await run(now + 1000);
  assert.deepEqual(notices, []);
  await run(now + 6 * 60_000);
  await run(now + 7 * 60_000);
  assert.deepEqual(notices, [crashed.stdout]);
});
