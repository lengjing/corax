import type { CoraxDynamicToolPart, CoraxMessagePart } from "#client/message-reducer-types.js";

export function isTerminalToolCallPart(part: CoraxMessagePart): part is CoraxDynamicToolPart {
  return part.type === "dynamic-tool" && part.toolMetadata?.corax?.kind === "tool-call";
}
