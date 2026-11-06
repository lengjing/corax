import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runNpm } from "./npm.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = join(root, "packages/corax");
const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined;
if (tag && tag !== `v${manifest.version}`) {
  throw new Error(`Release tag ${tag} must match corax version v${manifest.version}.`);
}

// Publish a clean staging package; never mutate development-only path maps.
const artifacts = join(root, "artifacts");
await mkdir(artifacts, { recursive: true });
const stage = await mkdtemp(join(artifacts, ".pack-"));
try {
  for (const name of ["bin", "dist", "LICENSE", "NOTICE", "README.md"]) {
    await cp(join(source, name), join(stage, name), { recursive: true });
  }
  const published = { ...manifest, private: false };
  delete published.devDependencies;
  delete published.scripts;
  published.files = ["bin", "dist", "LICENSE", "NOTICE", "README.md"];
  published.imports = publishedPaths(manifest.imports);
  published.exports = publishedPaths(manifest.exports);
  await writeFile(join(stage, "package.json"), `${JSON.stringify(published, null, 2)}\n`);
  await runNpm(["pack", "--ignore-scripts", "--quiet", "--pack-destination", stage], stage);
  const tarball = join(artifacts, "corax.tgz");
  await rm(tarball, { force: true });
  await rename(join(stage, `corax-${manifest.version}.tgz`), tarball);
  console.log(`[corax] npm package: ${tarball} (${manifest.version})`);
} finally {
  await rm(stage, { recursive: true, force: true, maxRetries: 5 });
}

function publishedPaths(value) {
  if (typeof value === "string") {
    if (value.startsWith("./src/")) return value.replace(/^\.\/src\//, "./dist/src/").replace(/\.ts$/, ".js");
    return value.replace(/^\.\/\.generated\//, "./dist/src/");
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, publishedPaths(entry)]));
  }
  return value;
}
