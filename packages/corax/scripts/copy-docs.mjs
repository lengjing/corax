import { cp, rm } from "node:fs/promises";

const target = new URL("../docs/", import.meta.url);
await rm(target, { recursive: true, force: true });
await rm(new URL("../dist/docs/", import.meta.url), { recursive: true, force: true });
await cp(new URL("../../../docs/", import.meta.url), target, { recursive: true });
