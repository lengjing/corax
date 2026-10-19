import { defineMemory } from "corax/memory";
import { fileMemory } from "corax/memory/file";
import { byPrincipal } from "corax/memory/scope";

export default defineMemory({
  description: "Persistent facts and preferences for the authenticated user.",
  namespace: "corax",
  provider: fileMemory(),
  scope: byPrincipal,
});
