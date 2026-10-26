import { defineSchedule } from "corax/schedules";

// The `run` form receives `{ to, waitUntil, appAuth }`: `to(channel, target)`
// can message another channel on the agent's behalf, `waitUntil` keeps the
// task alive for background work.
export default defineSchedule({
  cron: "*/15 * * * *",
  run() {
    console.log(`[heartbeat] ${new Date().toISOString()}`);
  },
});
