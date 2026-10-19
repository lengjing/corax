import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "./support/test.mjs";
import {
  sqliteScheduleProvider,
  pumpSqliteSchedules,
  readSqliteSchedulePath,
} from "../packages/corax/dist/src/public/schedules/providers/sqlite.js";
import { defineDynamicSchedules } from "../packages/corax/dist/src/public/schedules/subscription.js";
import { normalizeScheduleCollectionDefinition } from "../packages/corax/dist/src/internal/authored-definition/schedule-collection.js";

const execute = promisify(execFile);
const moduleURL = new URL(
  "../packages/corax/dist/src/public/schedules/providers/sqlite.js",
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
  const { path, now } = await setup(t);
  const previous = process.env.CORAX_SCHEDULES_SQLITE_PATH;
  process.env.CORAX_SCHEDULES_SQLITE_PATH = path;
  t.after(() => {
    if (previous === undefined) delete process.env.CORAX_SCHEDULES_SQLITE_PATH;
    else process.env.CORAX_SCHEDULES_SQLITE_PATH = previous;
  });
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
    ["-e", script, path, String(now + 1000)],
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
