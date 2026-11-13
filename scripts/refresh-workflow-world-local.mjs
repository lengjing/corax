import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Run explicitly when refreshing this dependency. Ordinary builds are offline.
const repository = "vercel/workflow";
const commit = "c11fc40013681fef9afe0b315b1d22284579bbe0";
const prefix = "packages/world-local/";
const destination = fileURLToPath(new URL("../vendor/workflow-world-local/", import.meta.url));
const tree = JSON.parse(
  execFileSync("gh", ["api", `repos/${repository}/git/trees/${commit}?recursive=1`], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }),
);
if (tree.truncated) throw new Error("Upstream tree was truncated");
const entries = tree.tree.filter(
  (entry) =>
    entry.type === "blob" &&
    (entry.path === "LICENSE.md" ||
      entry.path === "LICENSE" ||
      entry.path === `${prefix}package.json` ||
      entry.path === `${prefix}README.md` ||
      (entry.path.startsWith(`${prefix}src/`) &&
        /\.ts$/.test(entry.path) &&
        !/\.(test|spec|scenario|integration)\.|\/__tests__\//.test(entry.path))),
);
if (!entries.some((entry) => entry.path === `${prefix}src/db/schema.ts`))
  throw new Error("Pinned source does not contain the SQLite World");
const files = {};
for (const entry of entries) {
  if (entry.mode !== "100644") throw new Error(`Unexpected source mode: ${entry.path}`);
  const response = await fetch(
    `https://raw.githubusercontent.com/${repository}/${commit}/${entry.path}`,
  );
  if (!response.ok) throw new Error(`Source download failed: ${response.status} ${entry.path}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  if (blob !== entry.sha) throw new Error(`Git blob mismatch: ${entry.path}`);
  const relative = entry.path.startsWith(prefix) ? entry.path.slice(prefix.length) : "LICENSE";
  const name = relative === "package.json" ? "upstream-package.json" : relative;
  if (name.includes("..") || name.startsWith("/")) throw new Error("Invalid source path");
  const path = join(destination, name);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, bytes);
  files[name] = createHash("sha256").update(bytes).digest("hex");
}
await writeFile(
  join(destination, "UPSTREAM.json"),
  JSON.stringify(
    {
      repository,
      commit,
      pullRequest: 5235,
      files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
    },
    null,
    2,
  ) + "\n",
);
console.log(`Vendored ${Object.keys(files).length} verified files from ${repository}@${commit}`);
