import type { MemoryDocumentBackend } from "#public/memory/file/backend.js";
import { sqliteMemory } from "#public/memory/file/backends/sqlite.js";

export function defaultFileMemoryBackend(): MemoryDocumentBackend {
  return sqliteMemory();
}
