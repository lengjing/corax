/**
 * Authoring helpers for corax extensions — reusable packages mounted into an
 * agent through `agent/extensions/`.
 *
 * @example
 * ```ts
 * import { defineExtension } from "corax/extension";
 * ```
 */

export {
  defineExtension,
  type ExtensionHandle,
  type MountedExtension,
  type NoConfigExtensionHandle,
} from "#public/definitions/extension.js";
