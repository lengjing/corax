import { copyFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { loadDeclaration } from "../_shared.mjs";
import { verifyWorkflowWorldLocalSource } from "./world-local-source.mjs";

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve("@workflow/world-local/package.json"));
const sourceFiles = await verifyWorkflowWorldLocalSource(packageRoot);
const version = require("@workflow/world-local/package.json").version;
const declaration = await loadDeclaration("workflow-world-local.d.ts");

export default {
  packageName: "@workflow/world-local",
  entry: "src/index.ts",
  compiledPath: "@workflow/world-local",
  chunkGroup: "workflow",
  fingerprintFiles: ["package.json", "UPSTREAM.json", ...sourceFiles],
  async copyDeclarations({ destinationRoot }) {
    await writeFile(join(destinationRoot, "index.d.ts"), declaration);
    await copyFile(join(packageRoot, "UPSTREAM.json"), join(destinationRoot, "UPSTREAM.json"));
  },
  plugins: [
    {
      name: "corax-workflow-world-local-version",
      transform(source, id) {
        if (!id.replaceAll("\\", "/").endsWith("/src/init.ts")) return;
        const from = "version: 'bundled',";
        if (source.split(from).length !== 2)
          throw new Error("Unexpected pinned Workflow World version fallback");
        return { code: source.replace(from, `version: ${JSON.stringify(version)},`), map: null };
      },
    },
  ],
};
