import { join } from "node:path";
import { resolveCoraxDataDirectory } from "#shared/data-directory.js";

export const LOCAL_WORKFLOW_WORLD_DATA_DIRECTORY_RELATIVE_PATH = ".corax/.workflow-data";

export function resolveLocalWorkflowWorldDataDirectory(appRoot: string): string {
  return join(resolveCoraxDataDirectory(appRoot), ".workflow-data");
}
