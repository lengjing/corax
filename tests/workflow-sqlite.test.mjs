import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));

test(
  "SQLite World persists native sessions across production and dev process restarts",
  { timeout: 240_000 },
  async (t) => {
    let calls = 0;
    const model = createServer(async (request, response) => {
      for await (const _chunk of request) {
      }
      calls++;
      response.writeHead(200, { "content-type": "text/event-stream" });
      const emit = (delta, finish_reason = null) =>
        response.write(
          `data: ${JSON.stringify({
            id: "chatcmpl-fixture",
            object: "chat.completion.chunk",
            created: 0,
            model: "fixture",
            choices: [{ index: 0, delta, finish_reason }],
          })}\n\n`,
        );
      emit({ role: "assistant", content: "SQLite fixture reply." });
      emit({}, "stop");
      response.end("data: [DONE]\n\n");
    });
    await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise((resolve) => model.close(resolve)));
    const project = await mkdtemp(join(tmpdir(), "corax-sqlite-session-"));
    t.after(() => rm(project, { recursive: true, force: true, maxRetries: 5 }));
    await mkdir(join(project, "node_modules/@coraxjs"), { recursive: true });
    await mkdir(join(project, "node_modules/@ai-sdk"), { recursive: true });
    await symlink(
      join(root, "packages/corax"),
      join(project, "node_modules/@coraxjs/core"),
      "junction",
    );
    const coreRequire = createRequire(join(root, "packages/corax/package.json"));
    await symlink(
      dirname(coreRequire.resolve("@ai-sdk/openai/package.json")),
      join(project, "node_modules/@ai-sdk/openai"),
      "junction",
    );
    await mkdir(join(project, "channels"));
    await writeFile(
      join(project, "package.json"),
      JSON.stringify({
        name: "sqlite-session-fixture",
        private: true,
        type: "module",
        dependencies: { "@coraxjs/core": "0.1.1", "@ai-sdk/openai": "4.0.91" },
      }),
    );
    await writeFile(
      join(project, "agent.ts"),
      `
import { defineAgent } from '@coraxjs/core';
import { createOpenAI } from '@ai-sdk/openai';
const model = createOpenAI({ apiKey: 'fixture', baseURL: 'http://127.0.0.1:${model.address().port}/v1' });
export default defineAgent({ model: model.chat('fixture'), modelContextWindowTokens: 128000, experimental: { workflow: { world: 'local' } } });
`,
    );
    await writeFile(
      join(project, "channels/corax.ts"),
      `
import { coraxChannel } from '@coraxjs/core/channels/corax';
import { none } from '@coraxjs/core/channels/auth';
export default coraxChannel({ auth: none() });
`,
    );
    const options = {
      cwd: project,
      timeout: 90_000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        CORAX_PROJECT_ROOT: project,
        CORAX_DATA_DIR: join(project, "data"),
        AI_GATEWAY_API_KEY: "",
        CORAX_MODEL_CONNECTION: "",
        WORKFLOW_SPEC_VERSION: "8",
      },
    };
    await execute(process.execPath, [join(root, "packages/corax/bin/corax.js"), "build"], options);
    const helper = join(root, "tests/support/sqlite-session-check.mjs");
    for (const mode of ["production", "development"]) {
      const env = { ...options.env, CORAX_DATA_DIR: join(project, `data-${mode}`) };
      const first = await execute(process.execPath, [helper, project, "", mode], {
        ...options,
        env,
      });
      const result = JSON.parse(first.stdout.match(/SQLITE_SESSION=(.*)/)[1]);
      assert.equal(result.turns, 1);
      assert.ok((await stat(join(env.CORAX_DATA_DIR, ".workflow-data/world.db"))).isFile());
      const second = await execute(process.execPath, [helper, project, result.id, mode], {
        ...options,
        env,
      });
      assert.equal(JSON.parse(second.stdout.match(/SQLITE_SESSION=(.*)/)[1]).turns, 2);
    }
    assert.equal(calls, 4);
  },
);
