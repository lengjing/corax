import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const workflowWorldLocalCommit = "c11fc40013681fef9afe0b315b1d22284579bbe0";

export async function verifyWorkflowWorldLocalSource(packageRoot) {
  const manifest = JSON.parse(await readFile(join(packageRoot, "UPSTREAM.json"), "utf8"));
  if (manifest.repository !== "vercel/workflow" || manifest.commit !== workflowWorldLocalCommit)
    throw new Error("Unexpected Workflow World source revision");
  for (const [file, expected] of Object.entries(manifest.files)) {
    if (file.includes("..") || file.startsWith("/"))
      throw new Error("Invalid upstream source path");
    const bytes = await readFile(join(packageRoot, file));
    if (createHash("sha256").update(bytes).digest("hex") !== expected)
      throw new Error(`Workflow World source integrity mismatch: ${file}`);
  }
  return Object.keys(manifest.files).sort();
}
