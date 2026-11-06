import { defineMemory } from "@coraxjs/core/memory";
import { fileMemory } from "@coraxjs/core/memory/file";
import { byPrincipal } from "@coraxjs/core/memory/scope";

export default defineMemory({
  description: "Persistent facts and preferences for the authenticated user.",
  namespace: "corax-memory-example",
  provider: fileMemory(),
  scope: byPrincipal,
});
