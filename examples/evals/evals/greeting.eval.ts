import { defineEval } from "corax/evals";

// Run with `corax eval` from this directory; `--list` shows discovered evals.
export default defineEval({
  description: "Completes a greeting and includes hello in its reply.",
  tags: ["smoke"],
  async test(t) {
    const turn = await t.send("Please reply in English with a short greeting containing hello.");
    turn.expectOk();
    turn.messageIncludes(/hello/i);
  },
});
