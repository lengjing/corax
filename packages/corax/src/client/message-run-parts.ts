import type { CoraxMessage, CoraxMessagePart } from "#client/message-reducer-types.js";

type CoraxAssistantMessage = CoraxMessage & { readonly role: "assistant" };
type CoraxRunPart = Extract<CoraxMessagePart, { readonly type: "text" | "reasoning" }>;

function transition(
  message: CoraxAssistantMessage,
  input: {
    readonly stepIndex: number;
    readonly type: CoraxRunPart["type"];
    readonly id?: string;
  } & (
    | { readonly kind: "append"; readonly delta: string }
    | { readonly kind: "complete"; readonly text: string }
  ),
): CoraxAssistantMessage {
  const index = message.parts.findLastIndex(
    (part) => part.type === input.type && part.stepIndex === input.stepIndex,
  );
  const previous = index === -1 ? undefined : (message.parts[index] as CoraxRunPart);
  if (input.kind === "append" && !input.delta) return message;
  const current = previous?.state === "streaming" ? previous : undefined;
  const part: CoraxRunPart = {
    id: current?.id ?? input.id ?? `${message.id}:${input.type}:${message.parts.length}`,
    state: input.kind === "append" ? "streaming" : "done",
    stepIndex: input.stepIndex,
    text: input.kind === "append" ? (current?.text ?? "") + input.delta : input.text,
    type: input.type,
  };
  const parts = current
    ? [...message.parts.slice(0, index), part, ...message.parts.slice(index + 1)]
    : [...message.parts, part];
  return {
    ...message,
    metadata: {
      ...message.metadata,
      status: input.type === "text" && part.state === "done" ? "complete" : "streaming",
    },
    parts,
  };
}

export const messageRun = { transition } as const;
