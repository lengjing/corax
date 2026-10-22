import { describe, expect, it } from "vitest";

import {
  formatPromptCommandHelp,
  isPromptControlCommand,
  parsePromptCommand,
  promptCommandsFor,
  PROMPT_COMMANDS,
} from "./prompt-commands.js";

describe("parsePromptCommand", () => {
  it("parses /new and its /reset alias", () => {
    expect(parsePromptCommand("/new")).toEqual({ type: "new" });
    expect(parsePromptCommand("/reset")).toEqual({ type: "new" });
  });

  it("parses /cancel", () => {
    expect(parsePromptCommand("/cancel")).toEqual({ type: "cancel" });
  });

  it("parses /clear as a context clear", () => {
    expect(parsePromptCommand("/clear")).toEqual({ type: "clear" });
  });

  it("parses /exit and its /quit alias", () => {
    expect(parsePromptCommand("/exit")).toEqual({ type: "exit" });
    expect(parsePromptCommand("/quit")).toEqual({ type: "exit" });
  });

  it("parses /compact and /traces", () => {
    expect(parsePromptCommand("/compact")).toEqual({ type: "compact" });
    expect(parsePromptCommand("/traces")).toEqual({ type: "traces", argument: "" });
    expect(parsePromptCommand("/traces  latest ")).toEqual({ type: "traces", argument: "latest" });
  });

  it("parses bare /loglevel and /loglevel with a mode argument", () => {
    expect(parsePromptCommand("/loglevel")).toEqual({ type: "loglevel", argument: "" });
    expect(parsePromptCommand("/loglevel none")).toEqual({ type: "loglevel", argument: "none" });
    expect(parsePromptCommand("/loglevel  stderr ")).toEqual({
      type: "loglevel",
      argument: "stderr",
    });
  });

  it("parses /help and /info without arguments", () => {
    expect(parsePromptCommand("/help")).toEqual({ type: "help" });
    expect(parsePromptCommand("/info")).toEqual({ type: "info" });
    expect(parsePromptCommand("/info verbose")).toBeNull();
    expect(parsePromptCommand("/help verbose")).toBeNull();
  });

  it("trims surrounding whitespace before matching", () => {
    expect(parsePromptCommand("  /new  ")).toEqual({ type: "new" });
  });

  it("rejects near-misses and ordinary prompts", () => {
    expect(parsePromptCommand("/vercel")).toBeNull();
    expect(parsePromptCommand("/vc")).toBeNull();
    expect(parsePromptCommand("/vc:auth")).toBeNull();
    expect(parsePromptCommand("/channels")).toBeNull();
    expect(parsePromptCommand("tell me about /channels")).toBeNull();
    expect(parsePromptCommand("/")).toBeNull();
    expect(parsePromptCommand("")).toBeNull();
    expect(parsePromptCommand("hello")).toBeNull();
  });
});

describe("promptCommandsFor", () => {
  it("exposes project commands only for local sessions", () => {
    const names = promptCommandsFor("local").map((command) => command.name);
    expect(names).toContain("info");
    expect(names).toContain("traces");
    expect(names).not.toContain("vc:install");
    expect(names).not.toContain("vc:login");
    expect(names).not.toContain("vc:auth");
  });

  it("leads remote sessions with help and hides local commands", () => {
    const names = promptCommandsFor("remote").map((command) => command.name);
    expect(names[0]).toBe("help");
    expect(names).not.toContain("vc:install");
    expect(names).not.toContain("vc:login");
    expect(names).not.toContain("vc:auth");
    expect(names).not.toContain("info");
    expect(names).not.toContain("traces");
  });

  it("filters discovery and rejects the obsolete remote auth command", () => {
    const remote = promptCommandsFor("remote");
    expect(parsePromptCommand("/vc:auth")).toBeNull();
    expect(formatPromptCommandHelp(remote)).not.toContain("/vc:login");
    expect(formatPromptCommandHelp(remote)).not.toContain("/vc:auth");
    expect(formatPromptCommandHelp(remote)).not.toContain("/traces");
  });
});

describe("isPromptControlCommand", () => {
  it("is true exactly for recognized commands", () => {
    expect(isPromptControlCommand("/new")).toBe(true);
    expect(isPromptControlCommand("/reset")).toBe(true);
    expect(isPromptControlCommand("/clear")).toBe(true);
    expect(isPromptControlCommand("/loglevel warn")).toBe(true);
    expect(isPromptControlCommand("/unknown")).toBe(false);
    expect(isPromptControlCommand("hello")).toBe(false);
  });
});

describe("PROMPT_COMMANDS registry", () => {
  it("keeps names and aliases unique", () => {
    const tokens = PROMPT_COMMANDS.flatMap((spec) => [spec.name, ...spec.aliases]);
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it("describes every command", () => {
    for (const spec of PROMPT_COMMANDS) {
      expect(spec.description.length).toBeGreaterThan(0);
    }
  });

  it("only gives argument hints to commands that accept arguments", () => {
    for (const spec of PROMPT_COMMANDS) {
      if (spec.argumentHint !== undefined) expect(spec.takesArgument).toBe(true);
    }
  });

  it("builds a command every spec's own tokens parse to", () => {
    for (const spec of PROMPT_COMMANDS) {
      for (const alias of [spec.name, ...spec.aliases]) {
        expect(parsePromptCommand(`/${alias}`)).toEqual(spec.build(""));
      }
    }
  });

  it("only offers inline argument typeahead for log levels", () => {
    expect(
      PROMPT_COMMANDS.filter((spec) => spec.typeahead !== undefined).map((spec) => spec.name),
    ).toEqual(["loglevel"]);
  });
});

describe("formatPromptCommandHelp", () => {
  it("lists every command with its hint and aliases", () => {
    const help = formatPromptCommandHelp();
    for (const spec of PROMPT_COMMANDS) {
      expect(help).toContain(`/${spec.name}`);
      expect(help).toContain(spec.description);
      if (spec.argumentHint !== undefined) expect(help).toContain(spec.argumentHint);
      for (const alias of spec.aliases) expect(help).toContain(`(/${alias})`);
    }
    expect(help.split("\n")).toHaveLength(PROMPT_COMMANDS.length);
  });
});
