import { Cron } from "#compiled/croner/index.js";
import type { ScheduleExpression } from "#public/schedules/subscription.js";

/**
 * Resolves a one-time wall-clock value in its declared zone, never the host's
 * zone. Use the same parser as recurring schedules: explicit offsets identify
 * an instant, a DST gap moves forward, and a repeated hour uses its first occurrence.
 */
export function nextSingleScheduleTime(
  expression: Extract<ScheduleExpression, { type: "single" }>,
  after: number,
): number | null {
  // Direct provider callers can supply an ISO instant with sub-second
  // precision. Croner works at second precision, so preserve those instants.
  if (/(?:z|[+-]\d{2}:?\d{2})$/iu.test(expression.at)) {
    const at = Date.parse(expression.at);
    if (!Number.isFinite(at)) throw new Error("Schedule time must be a valid date.");
    return at > after ? at : null;
  }
  const schedule = new Cron(expression.at, {
    paused: true,
    timezone: expression.timezone ?? "UTC",
  });
  try {
    const next = schedule.nextRun(new Date(after))?.getTime();
    // During a repeated DST hour Croner can return the first occurrence even
    // when it is already past. A single schedule must not be queued again.
    return next !== undefined && next > after ? next : null;
  } finally {
    schedule.stop();
  }
}
