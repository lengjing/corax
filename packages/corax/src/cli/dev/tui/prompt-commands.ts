type PromptCommandTarget = "local" | "remote";

/** The slash commands the prompt accepts. */
export type PromptCommand =
  | { type: "new" }
  | { type: "cancel" }
  | { type: "clear" }
  | { type: "compact" }
  | { type: "exit" }
  | { type: "help" }
  | { type: "info" }
  | { type: "loglevel"; argument: string }
  | { type: "traces"; argument: string };

/**
 * Metadata for one slash command. The registry describes commands — their
 * names, aliases, and discovery copy — it never executes them: dispatch stays
 * with the runner.
 */
export interface PromptCommandSpec {
  /** Canonical name without the slash, e.g. "loglevel". */
  readonly name: string;
  readonly aliases: readonly string[];
  /** One-line discovery copy shown by the typeahead. */
  readonly description: string;
  /** Optional argument shape shown dim after the name, e.g. "[trace]". */
  readonly argumentHint?: string;
  /** Accepts a trailing argument (enables `/name <arg>` parsing). */
  readonly takesArgument: boolean;
  /** Whether recalling this command would reopen a modal or take over prompt navigation. */
  readonly history: "keep" | "omit";
  /** Inline argument suggestions, when this command has a catalog-backed grammar. */
  readonly typeahead?: { readonly maxArguments: number; readonly loadingLabel: string };
  /** Maps a recognized invocation to its parsed command. */
  readonly build: (argument: string) => PromptCommand;
}

interface PromptCommandDefinition extends PromptCommandSpec {
  readonly targets: readonly PromptCommandTarget[];
}

/**
 * Every slash command the prompt accepts, in typeahead display order. One
 * module owns the command list so the runner's dispatch, the renderer's
 * transcript-echo suppression, and command discovery cannot drift apart.
 */
const PROMPT_COMMAND_DEFINITIONS = [
  {
    name: "new",
    history: "keep",
    aliases: ["reset"],
    description: "Start a fresh session",
    takesArgument: false,
    build: () => ({ type: "new" }),
    targets: ["local", "remote"],
  },
  {
    name: "clear",
    history: "keep",
    aliases: [],
    description: "Clear the session context and keep the session",
    takesArgument: false,
    build: () => ({ type: "clear" }),
    targets: ["local", "remote"],
  },
  {
    name: "compact",
    history: "keep",
    aliases: [],
    description: "Compact the current session context",
    takesArgument: false,
    build: () => ({ type: "compact" }),
    targets: ["local", "remote"],
  },
  {
    name: "cancel",
    history: "keep",
    aliases: [],
    description: "Cancel the running turn",
    takesArgument: false,
    build: () => ({ type: "cancel" }),
    targets: ["local", "remote"],
  },
  {
    name: "traces",
    history: "omit",
    aliases: [],
    description: "Open the local trace viewer",
    argumentHint: "[trace]",
    takesArgument: true,
    build: (argument) => ({ type: "traces", argument }),
    targets: ["local"],
  },
  {
    name: "loglevel",
    history: "omit",
    aliases: [],
    description: "Choose the minimum displayed log severity",
    argumentHint: "[none|error|warn|debug|all]",
    takesArgument: true,
    typeahead: { maxArguments: 1, loadingLabel: "log levels" },
    build: (argument) => ({ type: "loglevel", argument }),
    targets: ["local", "remote"],
  },
  {
    name: "info",
    history: "omit",
    aliases: [],
    description: "Show application and messaging information",
    takesArgument: false,
    build: () => ({ type: "info" }),
    targets: ["local"],
  },
  {
    name: "help",
    history: "omit",
    aliases: [],
    description: "Show available commands",
    takesArgument: false,
    build: () => ({ type: "help" }),
    targets: ["local", "remote"],
  },
  {
    name: "exit",
    history: "keep",
    aliases: ["quit"],
    description: "Quit the TUI",
    takesArgument: false,
    build: () => ({ type: "exit" }),
    targets: ["local", "remote"],
  },
] satisfies readonly PromptCommandDefinition[];

export type ArgumentTypeaheadCommand = Extract<
  (typeof PROMPT_COMMAND_DEFINITIONS)[number],
  { typeahead: object }
>["name"];

export const PROMPT_COMMANDS: readonly PromptCommandSpec[] = PROMPT_COMMAND_DEFINITIONS;

export function promptCommandsFor(target: PromptCommandTarget): readonly PromptCommandSpec[] {
  const commands = PROMPT_COMMAND_DEFINITIONS.filter((definition) =>
    definition.targets.some((supportedTarget) => supportedTarget === target),
  );
  // Lead remote discovery with help rather than the session-reset command.
  if (target === "remote") {
    return [
      ...commands.filter((command) => command.name === "help"),
      ...commands.filter((command) => command.name !== "help"),
    ];
  }
  return commands;
}

/**
 * Recognizes the slash commands the prompt accepts. `/new` (and `/reset`)
 * starts a fresh session and transcript; `/cancel` stops the running turn;
 * `/clear` clears context in place; `/compact` queues context compaction; `/exit` (and
 * `/quit`) terminate the TUI like Ctrl+C. Anything else — including unknown
 * `/text` — is a normal message.
 */
export function parsePromptCommand(prompt: string): PromptCommand | null {
  const match = promptCommandSpec(prompt);
  return match === undefined ? null : match.spec.build(match.argument);
}

/** Resolve an invocation and its history policy from the same command definition. */
export function promptCommandSpec(
  prompt: string,
): { spec: PromptCommandSpec; argument: string } | undefined {
  const trimmed = prompt.trim();
  if (!trimmed.startsWith("/")) return undefined;
  for (const spec of PROMPT_COMMANDS) {
    for (const alias of [spec.name, ...spec.aliases]) {
      const token = `/${alias}`;
      if (trimmed === token) return { spec, argument: "" };
      if (spec.takesArgument && trimmed.startsWith(`${token} `)) {
        return { spec, argument: trimmed.slice(token.length).trim() };
      }
    }
  }
  return undefined;
}

/** True for prompts that are commands, which never echo as user messages. */
export function isPromptControlCommand(prompt: string): boolean {
  return parsePromptCommand(prompt) !== null;
}

/**
 * The table `/help` prints: one line per command — slash name, argument
 * hint, and aliases padded into a column, description after.
 */
export function formatPromptCommandHelp(
  commands: readonly PromptCommandSpec[] = PROMPT_COMMANDS,
): string {
  const entries = commands.map((spec) => {
    const hint = spec.argumentHint === undefined ? "" : ` ${spec.argumentHint}`;
    const aliases = spec.aliases.map((alias) => ` (/${alias})`).join("");
    return { invocation: `/${spec.name}${hint}${aliases}`, description: spec.description };
  });
  const column = Math.max(...entries.map((entry) => entry.invocation.length)) + 2;
  return entries.map((entry) => entry.invocation.padEnd(column) + entry.description).join("\n");
}
