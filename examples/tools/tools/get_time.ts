import { defineTool } from "corax/tools";
import { z } from "zod";

import { formatCurrentTime } from "../lib/time.js";

// The file name is the tool name the model sees: `get_time`.
export default defineTool({
  description: "Get the current date and time in an IANA time zone such as Asia/Shanghai.",
  inputSchema: z.object({
    timeZone: z.string().describe("IANA time zone, for example Asia/Shanghai or UTC"),
  }),
  execute({ timeZone }) {
    return { timeZone, now: formatCurrentTime(timeZone) };
  },
});
