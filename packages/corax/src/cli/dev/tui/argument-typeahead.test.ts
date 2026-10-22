import { describe, expect, it } from "vitest";

import {
  argumentTypeaheadCompletion,
  argumentTypeaheadFor,
  argumentTypeaheadQuery,
  moveArgumentTypeaheadSelection,
  renderArgumentSuggestions,
  selectedArgumentSuggestion,
} from "./argument-typeahead.js";
import { stripAnsi } from "#cli/ui/terminal-text.js";
import { createTheme } from "./theme.js";

const logLevels = [
  { value: "error", label: "error", hint: "Errors only" },
  { value: "warn", label: "warn", hint: "Warnings and errors" },
];

describe("argumentTypeaheadQuery", () => {
  it("parses the active log level token", () => {
    expect(argumentTypeaheadQuery("/loglevel er")).toEqual({
      command: "loglevel",
      argument: "er",
      completed: [],
      argumentStart: 10,
    });
    expect(argumentTypeaheadQuery("/loglevel ")).toEqual({
      command: "loglevel",
      argument: "",
      completed: [],
      argumentStart: 10,
    });
    expect(argumentTypeaheadQuery("/loglevel  warn")).toEqual({
      command: "loglevel",
      argument: "warn",
      completed: [],
      argumentStart: 11,
    });
    expect(argumentTypeaheadQuery("/loglevel warn ")).toBeUndefined();
    expect(argumentTypeaheadQuery("/loglevel one two")).toBeUndefined();
    expect(argumentTypeaheadQuery("hello")).toBeUndefined();
  });
});

describe("argumentTypeaheadFor", () => {
  it("filters and completes log levels", () => {
    const state = argumentTypeaheadFor(
      { command: "loglevel", argument: "wa", completed: [], argumentStart: 10 },
      logLevels,
    );
    expect(state.suggestions).toHaveLength(1);
    expect(argumentTypeaheadCompletion(state, selectedArgumentSuggestion(state)!)).toBe(
      "/loglevel warn",
    );
  });

  it("preserves the selected suggestion", () => {
    let state = argumentTypeaheadFor(
      { command: "loglevel", argument: "", completed: [], argumentStart: 10 },
      logLevels,
    );
    state = moveArgumentTypeaheadSelection(state, 1);
    expect(selectedArgumentSuggestion(state)).toMatchObject({ value: "warn" });
  });

  it("sanitizes catalog text before it can render or complete", () => {
    const state = argumentTypeaheadFor(
      { command: "loglevel", argument: "", completed: [], argumentStart: 10 },
      [{ value: "\u001b]52;c;clipboard\u0007warn", label: "warn", hint: "\u001b[31mred" }],
    );
    expect(state.suggestions[0]).toMatchObject({ value: "warn", hint: "red" });
    expect(argumentTypeaheadCompletion(state, selectedArgumentSuggestion(state)!)).toBe(
      "/loglevel warn",
    );
  });

  it("keeps the selected item visible in an eight-row window", () => {
    const suggestions = Array.from({ length: 9 }, (_, index) => ({
      value: `level-${index}`,
      label: `Level ${index}`,
    }));
    const state = {
      ...argumentTypeaheadFor(
        { command: "loglevel", argument: "", completed: [], argumentStart: 10 },
        suggestions,
      ),
      selectedIndex: 8,
    };
    const rows = renderArgumentSuggestions(
      state,
      createTheme({ color: false, unicode: true }),
      80,
    ).map(stripAnsi);
    expect(rows).toHaveLength(8);
    expect(rows.some((row) => row.includes("level-8"))).toBe(true);
    expect(rows.some((row) => row.includes("level-0"))).toBe(false);
  });
});
