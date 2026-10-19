import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Database } from "bun:sqlite";
import {
  MemoryDocumentConflictError,
  type MemoryDocumentBackend,
} from "#public/memory/file/backend.js";

export interface SqliteMemoryOptions {
  readonly path?: string;
}

/** Process-independent, optimistic document writes backed by a local SQLite database. */
export function sqliteMemory(options: SqliteMemoryOptions = {}): MemoryDocumentBackend {
  const path = resolve(
    options.path ||
      process.env.CORAX_MEMORY_SQLITE_PATH ||
      `${process.env.CORAX_DATA_DIR || ".corax"}/memory.sqlite`,
  );
  const open = () => {
    mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    try {
      db.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS memory_documents (
          key TEXT PRIMARY KEY, content TEXT NOT NULL, version TEXT NOT NULL
        );
      `);
      return db;
    } catch (error) {
      db.close(true);
      throw error;
    }
  };

  return {
    async read({ key, signal }) {
      signal.throwIfAborted();
      const db = open();
      try {
        const row = db
          .prepare<{ content: string; version: string }, [string]>("SELECT content, version FROM memory_documents WHERE key = ?")
          .get(key);
        return row ? { content: String(row.content), version: String(row.version) } : null;
      } finally {
        db.close(true);
      }
    },
    async write({ key, content, expectedVersion, signal }) {
      signal.throwIfAborted();
      const db = open();
      try {
        const version = randomUUID();
        const result =
          expectedVersion === null
            ? db
                .prepare(
                  "INSERT INTO memory_documents (key, content, version) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING",
                )
                .run(key, content, version)
            : db
                .prepare(
                  "UPDATE memory_documents SET content = ?, version = ? WHERE key = ? AND version = ?",
                )
                .run(content, version, key, expectedVersion);
        if (result.changes !== 1) throw new MemoryDocumentConflictError(key);
        return { content, version };
      } finally {
        db.close(true);
      }
    },
  };
}
