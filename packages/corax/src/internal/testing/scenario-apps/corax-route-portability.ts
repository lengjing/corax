import type { ScenarioAppDescriptor } from "#internal/testing/scenario-app.js";

export const CORAX_ROUTE_PORTABILITY_DESCRIPTOR: ScenarioAppDescriptor = {
  files: {
    "agent/channels/corax.ts": `import { none } from "corax/channels/auth";
import { coraxChannel } from "corax/channels/corax";

export default coraxChannel({
  auth: none(),
});
`,
  },
  name: "corax-route-portability",
};
