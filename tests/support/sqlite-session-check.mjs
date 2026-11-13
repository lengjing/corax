import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { startProductionServer } from "../../packages/corax/dist/src/internal/nitro/host/start-production-server.js";
import { createDevelopmentServer } from "../../packages/corax/dist/src/cli/dev/local-server-process.js";

const [project, previousId, mode = "production"] = process.argv.slice(2);
const expectedTurns = previousId ? 2 : 1;
let server;
let development;
try {
  if (mode === "development") {
    development = createDevelopmentServer(project, {
      host: "127.0.0.1",
      port: 0,
      resume: true,
      developmentExtensions: { enabled: [] },
    });
    const started = await development.start();
    server = { url: started.url, close: () => development.close() };
  } else server = await startProductionServer(project, { host: "127.0.0.1", port: 0 });
  const path = previousId ? `/corax/v1/session/${previousId}` : "/corax/v1/session";
  const response = await fetch(new URL(path, server.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: previousId ? "second" : "first" }),
  });
  const admission = await response.json();
  assert.ok(response.ok, `Admission failed: ${response.status} ${JSON.stringify(admission)}`);
  const id = previousId || admission.sessionId;
  assert.match(id, /^wrun_/);
  const deadline = Date.now() + 20_000;
  let events = [];
  while (Date.now() < deadline) {
    const history = await fetch(new URL(`/corax/v1/session/${id}/stream?follow=false`, server.url));
    if (history.ok) {
      events = (await history.text())
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
      const failures = events.filter((event) =>
        ["turn.failed", "session.failed"].includes(event.type),
      );
      assert.equal(failures.length, 0, JSON.stringify(failures));
      if (events.filter((event) => event.type === "turn.completed").length >= expectedTurns) break;
    } else await history.body?.cancel();
    await delay(50);
  }
  assert.equal(
    events.filter((event) => event.type === "turn.completed").length,
    expectedTurns,
    `Unsettled session: ${events.map((event) => event.type).join(",")}`,
  );
  const inputs = events
    .filter((event) => event.type === "message.received")
    .map((event) => event.data.message);
  assert.deepEqual(inputs, previousId ? ["first", "second"] : ["first"]);
  await delay(150);
  console.log(
    `SQLITE_SESSION=${JSON.stringify({ id, turns: expectedTurns, events: events.length })}`,
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await server?.close();
}
process.exit(process.exitCode ?? 0);
