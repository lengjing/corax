import assert from "node:assert/strict";
import { createDevelopmentServer } from "../../packages/corax/dist/src/cli/dev/local-server-process.js";

const root = process.argv[2];
process.chdir(root);
const server = createDevelopmentServer(root, {
  host: "127.0.0.1",
  port: 0,
  developmentExtensions: { enabled: [] },
});
try {
  const handle = await server.start();
  const response = await fetch(new URL("/corax/v1/health", handle.url));
  assert.equal(response.status, 200, await response.text());
  console.log("DEVELOPMENT_SMOKE=ok");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await server.close();
}
process.exit(process.exitCode ?? 0);
