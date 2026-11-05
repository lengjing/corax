import { resolve, join, relative, isAbsolute } from "node:path";

/** Configurable application data root. Isolated compiler/runtime roots keep their own artifacts. */
export function resolveCoraxDataDirectory(appRoot: string): string {
  const configured = process.env.CORAX_DATA_DIR?.trim();
  const project = resolve(process.env.CORAX_PROJECT_ROOT || process.cwd());
  return configured && resolve(appRoot) === project
    ? resolve(project, configured)
    : join(appRoot, ".corax");
}

export function isCoraxDataPath(path: string): boolean {
  if (!process.env.CORAX_DATA_DIR) return false;
  const root = resolveCoraxDataDirectory(process.env.CORAX_PROJECT_ROOT || process.cwd());
  const child = relative(root, resolve(path));
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}
