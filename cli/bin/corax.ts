#!/usr/bin/env -S bun --no-env-file

import { main } from "../src/main.ts";

try {
  await main(process.argv.slice(2));
} catch (error) {
  const report = (value: unknown): void => {
    console.error(value instanceof Error ? value.message : String(value));
    if (value instanceof AggregateError) for (const child of value.errors) report(child);
    else if (value instanceof Error && value.cause) report(value.cause);
  };
  report(error);
  process.exitCode = 1;
}
