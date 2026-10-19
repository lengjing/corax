import { access } from "node:fs/promises";

export async function verifyBuiltinExtensions() {
  for (const path of [
    "extensions/code/extension/extension.ts",
    "extensions/git/extension/extension.ts",
    "computer-use/extension/extension.ts",
  ]) {
    await access(new URL(`../src/${path}`, import.meta.url)).catch(() => {
      throw new Error(
        `Missing built-in extension source: src/${path}. Extensions are maintained inside this package's src tree.`,
      );
    });
  }
}
