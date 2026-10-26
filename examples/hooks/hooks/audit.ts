import { defineHook } from "corax/hooks";

// Hooks observe the durable event stream after each event is recorded. They
// cannot change model context; use `defineDynamic` in a slot for that.
export default defineHook({
  events: {
    "turn.completed": (event, ctx) => {
      console.log(`[audit] ${ctx.agent.name} completed turn ${event.data.turnId}`);
    },
    "action.result": (event, ctx) => {
      const { result, status } = event.data;
      const action = result.kind === "tool-result" ? result.toolName : result.kind;
      console.log(`[audit] ${ctx.agent.name} ${action} ${status}`);
    },
  },
});
