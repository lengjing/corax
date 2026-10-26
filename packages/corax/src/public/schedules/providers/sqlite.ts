import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { Cron } from "#compiled/croner/index.js";
import { nextSingleScheduleTime } from "#shared/schedule-time.js";
import type {
  ScheduleExpression,
  ScheduleProvider,
  ScheduleRecord,
  ScheduleOccurrence,
} from "#public/schedules/subscription.js";
import type { ScheduleProviderContext } from "#public/schedules/provider-types.js";

const PATH = Symbol.for("corax.sqlite-schedules.path");
const DEFAULT_SCHEDULES_PATH = ".corax/schedules.sqlite";
const LEASE_MS = 5 * 60_000;
const MAX_DELIVERIES = 10;
type Row = Record<string, string | number | bigint | Uint8Array | null>;

function open(path: string): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  try {
    db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS schedules (
        namespace TEXT NOT NULL, name TEXT NOT NULL, scheduleId TEXT NOT NULL UNIQUE,
        application TEXT NOT NULL, collection TEXT NOT NULL, expression TEXT NOT NULL,
        payload TEXT NOT NULL, state TEXT NOT NULL, nextAt INTEGER,
        createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
        PRIMARY KEY(namespace, name)
      );
      CREATE TABLE IF NOT EXISTS schedule_operations (id TEXT PRIMARY KEY, result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS schedule_occurrences (
        executionId TEXT PRIMARY KEY, namespace TEXT NOT NULL, name TEXT NOT NULL,
        scheduleId TEXT NOT NULL, application TEXT NOT NULL, collection TEXT NOT NULL,
        payload TEXT NOT NULL, scheduledAt INTEGER NOT NULL, state TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, retryAt INTEGER NOT NULL, manual INTEGER NOT NULL DEFAULT 0,
        leaseUntil INTEGER, leaseToken TEXT
      );
      CREATE INDEX IF NOT EXISTS schedules_due ON schedules(application, collection, state, nextAt);
      CREATE INDEX IF NOT EXISTS occurrences_due ON schedule_occurrences(application, collection, state, retryAt);
    `);
    return db;
  } catch (error) {
    db.close(true);
    throw error;
  }
}

function transaction<T>(db: Database, action: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function json(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined || Buffer.byteLength(text) > 65_536)
    throw new Error("Schedule data exceeds 64 KiB.");
  return text;
}

function nextTime(expression: ScheduleExpression, after: number): number | null {
  if (expression.type === "single") {
    return nextSingleScheduleTime(expression, after);
  }
  if (expression.jitter !== undefined && expression.jitter !== 0) {
    throw new Error("SQLite schedules do not support jitter; omit it or set it to zero.");
  }
  const cron = new Cron(expression.cron, { paused: true, timezone: expression.timezone || "UTC" });
  try {
    return cron.nextRun(new Date(after))?.getTime() ?? null;
  } finally {
    cron.stop();
  }
}

function record(row: Row): ScheduleRecord {
  return {
    name: String(row.name),
    scheduleId: String(row.scheduleId),
    expression: JSON.parse(String(row.expression)) as ScheduleExpression,
    state: row.state as ScheduleRecord["state"],
    createdAt: Number(row.createdAt),
    updatedAt: Number(row.updatedAt),
  };
}

function requireSchedule(db: Database, context: ScheduleProviderContext, name: string): Row {
  const row = db
    .prepare<Row, SQLQueryBindings[]>("SELECT * FROM schedules WHERE namespace = ? AND name = ?")
    .get(context.namespace, name);
  if (!row || row.application !== context.target.key || row.collection !== context.collection) {
    throw new Error(`Schedule ${JSON.stringify(name)} does not exist.`);
  }
  return row;
}

function enqueue(
  db: Database,
  row: Row,
  at: number,
  executionId = randomUUID(),
  manual = false,
): void {
  db.prepare(`INSERT INTO schedule_occurrences
    (executionId, namespace, name, scheduleId, application, collection, payload, scheduledAt, state, retryAt, manual)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`).run(
    executionId,
    row.namespace!,
    row.name!,
    row.scheduleId!,
    row.application!,
    row.collection!,
    row.payload!,
    at,
    at,
    manual ? 1 : 0,
  );
}

/** Durable schedule management and occurrence queue for a self-hosted Bun service. */
export function sqliteScheduleProvider(
  /** `path` defaults to `.corax/schedules.sqlite` under the working directory. */
  options: { readonly path?: string } = {},
): ScheduleProvider {
  const path = resolve(options.path ?? DEFAULT_SCHEDULES_PATH);
  const once = <T>(
    context: ScheduleProviderContext,
    operation: string,
    name: string,
    action: (db: Database) => T,
  ): T => {
    context.abortSignal.throwIfAborted();
    const db = open(path);
    try {
      return transaction(db, () => {
        const id = JSON.stringify([
          context.target.key,
          context.collection,
          context.namespace,
          context.operationId,
          operation,
          name,
        ]);
        const previous = db.prepare<Row, SQLQueryBindings[]>("SELECT result FROM schedule_operations WHERE id = ?").get(id);
        if (previous) return JSON.parse(String(previous.result)) as T;
        const result = action(db);
        db.prepare("INSERT INTO schedule_operations VALUES (?, ?)").run(id, json(result));
        return result;
      });
    } finally {
      db.close(true);
    }
  };
  const changeState = (context: ScheduleProviderContext, name: string, enabled: boolean) =>
    once(context, enabled ? "enable" : "disable", name, (db) => {
      const row = requireSchedule(db, context, name);
      const now = Date.now();
      const nextAt = enabled ? nextTime(JSON.parse(String(row.expression)), now) : null;
      db.prepare(
        "UPDATE schedules SET state = ?, nextAt = ?, updatedAt = ? WHERE namespace = ? AND name = ?",
      ).run(
        enabled ? (nextAt === null ? "completed" : "active") : "inactive",
        nextAt,
        now,
        context.namespace,
        name,
      );
      return record(requireSchedule(db, context, name));
    });

  const provider: ScheduleProvider = {
    kind: "sqlite",
    async create(context, input) {
      return once(context, "create", input.name, (db) => {
        const now = Date.now();
        const nextAt = nextTime(input.expression, now);
        const count = db
          .prepare<Row, SQLQueryBindings[]>("SELECT COUNT(*) AS count FROM schedules WHERE namespace = ?")
          .get(context.namespace);
        if (Number(count?.count) >= 1000)
          throw new Error("This schedule namespace has reached its 1000-schedule limit.");
        db.prepare("INSERT INTO schedules VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
          context.namespace,
          input.name,
          randomUUID(),
          context.target.key,
          context.collection,
          json(input.expression),
          json(input.payload),
          nextAt === null ? "completed" : "active",
          nextAt,
          now,
          now,
        );
        return record(requireSchedule(db, context, input.name));
      });
    },
    async get(context, name) {
      context.abortSignal.throwIfAborted();
      const db = open(path);
      try {
        const row = db
          .prepare<Row, SQLQueryBindings[]>(
            "SELECT * FROM schedules WHERE namespace = ? AND name = ? AND application = ? AND collection = ?",
          )
          .get(context.namespace, name, context.target.key, context.collection);
        return row ? record(row) : null;
      } finally {
        db.close(true);
      }
    },
    async list(context, query) {
      context.abortSignal.throwIfAborted();
      const offset = Number(query.cursor || 0);
      const limit = query.limit ?? 50;
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100
      ) {
        throw new Error("Invalid schedule pagination; limit must be between 1 and 100.");
      }
      const db = open(path);
      try {
        const rows = db
          .prepare<Row, SQLQueryBindings[]>(
            "SELECT * FROM schedules WHERE namespace = ? AND application = ? AND collection = ? ORDER BY name LIMIT ? OFFSET ?",
          )
          .all(context.namespace, context.target.key, context.collection, limit + 1, offset);
        return {
          data: rows.slice(0, limit).map(record),
          cursor: rows.length > limit ? String(offset + limit) : null,
        };
      } finally {
        db.close(true);
      }
    },
    async update(context, name, patch) {
      return once(context, "update", name, (db) => {
        const row = requireSchedule(db, context, name);
        const expression = patch.expression ?? JSON.parse(String(row.expression));
        const now = Date.now();
        const changedTime = patch.expression === undefined ? row.nextAt : nextTime(expression, now);
        const nextAt = row.state === "active" && changedTime !== null ? Number(changedTime) : null;
        db.prepare(
          "UPDATE schedules SET expression = ?, payload = ?, nextAt = ?, state = ?, updatedAt = ? WHERE namespace = ? AND name = ?",
        ).run(
          json(expression),
          patch.payload === undefined ? row.payload! : json(patch.payload),
          nextAt,
          row.state === "active" && nextAt === null ? "completed" : row.state!,
          now,
          context.namespace,
          name,
        );
        return record(requireSchedule(db, context, name));
      });
    },
    async enable(context, name) {
      return changeState(context, name, true);
    },
    async disable(context, name) {
      return changeState(context, name, false);
    },
    async invoke(context, name) {
      once(context, "invoke", name, (db) => {
        const row = requireSchedule(db, context, name);
        if (row.state === "completed") throw new Error("Completed schedules cannot be invoked.");
        enqueue(db, row, Date.now(), randomUUID(), true);
        return null;
      });
    },
    async delete(context, name) {
      return once(context, "delete", name, (db) => {
        const row = db
          .prepare<Row, SQLQueryBindings[]>(
            "SELECT * FROM schedules WHERE namespace = ? AND name = ? AND application = ? AND collection = ?",
          )
          .get(context.namespace, name, context.target.key, context.collection);
        if (!row) return false;
        db.prepare("DELETE FROM schedules WHERE namespace = ? AND name = ?").run(
          context.namespace,
          name,
        );
        db.prepare(
          "UPDATE schedule_occurrences SET state = 'cancelled' WHERE scheduleId = ? AND state = 'pending'",
        ).run(row.scheduleId!);
        return true;
      });
    },
  };
  Object.defineProperty(provider, PATH, { value: path });
  return provider;
}

export function readSqliteSchedulePath(provider: ScheduleProvider): string | undefined {
  return (provider as ScheduleProvider & { [PATH]?: string })[PATH];
}

export interface SqliteScheduleDelivery {
  readonly collection: string;
  readonly payload: unknown;
  readonly occurrence: ScheduleOccurrence;
}

/** Claims durable occurrences with a lease; failed callbacks retry with the same execution ID. */
export async function pumpSqliteSchedules(input: {
  readonly path: string;
  readonly application: string;
  readonly collection: string;
  readonly at: Date;
  readonly signal: AbortSignal;
  readonly deliver: (delivery: SqliteScheduleDelivery) => Promise<void>;
  readonly onFailure?: (delivery: SqliteScheduleDelivery) => Promise<void>;
}): Promise<void> {
  input.signal.throwIfAborted();
  const now = input.at.getTime();
  const token = randomUUID();
  const db = open(input.path);
  let jobs: Row[];
  try {
    jobs = transaction(db, () => {
      const due = db
        .prepare<Row, SQLQueryBindings[]>(
          "SELECT * FROM schedules WHERE application = ? AND collection = ? AND state = 'active' AND nextAt <= ? ORDER BY nextAt LIMIT 16",
        )
        .all(input.application, input.collection, now);
      for (const row of due) {
        enqueue(db, row, Number(row.nextAt));
        const nextAt = nextTime(JSON.parse(String(row.expression)), now);
        db.prepare(
          "UPDATE schedules SET nextAt = ?, state = ?, updatedAt = ? WHERE scheduleId = ?",
        ).run(nextAt, nextAt === null ? "completed" : "active", now, row.scheduleId!);
      }
      db.prepare(
        "UPDATE schedule_occurrences SET state = 'failed' WHERE application = ? AND collection = ? AND state = 'running' AND leaseUntil <= ? AND attempts >= ?",
      ).run(input.application, input.collection, now, MAX_DELIVERIES);
      return db
        .prepare<Row, SQLQueryBindings[]>(`UPDATE schedule_occurrences SET state = 'running', leaseUntil = ?, leaseToken = ?, attempts = attempts + 1
        WHERE executionId IN (SELECT executionId FROM schedule_occurrences WHERE application = ? AND collection = ?
          AND (state = 'pending' OR (state = 'running' AND leaseUntil <= ?)) AND retryAt <= ? AND attempts < ?
          ORDER BY scheduledAt LIMIT 1) RETURNING *`)
        .all(now + LEASE_MS, token, input.application, input.collection, now, now, MAX_DELIVERIES);
    });
  } finally {
    db.close(true);
  }

  for (const job of jobs) {
    if (input.signal.aborted) return;
    let success = false;
    const check = open(input.path);
    try {
      const schedule = check
        .prepare<Row, SQLQueryBindings[]>("SELECT state FROM schedules WHERE scheduleId = ?")
        .get(job.scheduleId!);
      if (!schedule || (schedule.state === "inactive" && Number(job.manual) !== 1)) {
        check
          .prepare(
            "UPDATE schedule_occurrences SET state = 'cancelled' WHERE executionId = ? AND leaseToken = ?",
          )
          .run(job.executionId!, token);
        continue;
      }
    } finally {
      check.close(true);
    }
    const delivery: SqliteScheduleDelivery = {
      collection: input.collection,
      payload: JSON.parse(String(job.payload)),
      occurrence: {
        name: String(job.name),
        scheduleId: String(job.scheduleId),
        executionId: String(job.executionId),
        scheduledAt: new Date(Number(job.scheduledAt)).toISOString(),
      },
    };
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        input.deliver(delivery),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error("Scheduled callback timed out.")), 120_000);
          deadline.unref();
        }),
      ]);
      success = true;
    } catch {
      // Persist retry state without storing credentials or arbitrary provider errors.
    } finally {
      clearTimeout(deadline);
    }
    const finish = open(input.path);
    try {
      const attempts = Number(job.attempts);
      finish
        .prepare(
          "UPDATE schedule_occurrences SET state = ?, retryAt = ?, leaseUntil = NULL, leaseToken = NULL WHERE executionId = ? AND leaseToken = ?",
        )
        .run(
          success ? "done" : attempts >= MAX_DELIVERIES ? "failed" : "pending",
          now + Math.min(60_000, 1000 * 2 ** attempts),
          job.executionId!,
          token,
        );
    } finally {
      finish.close(true);
    }
    if (!success && Number(job.attempts) >= MAX_DELIVERIES) await input.onFailure?.(delivery);
  }
}
