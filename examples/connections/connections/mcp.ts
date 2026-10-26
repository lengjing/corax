import { defineDynamic, defineMcpClientConnection } from "corax/connections";

// A connection resolved per session: present only when the deployment
// configures an MCP server, so the example runs without one.
export default defineDynamic({
  events: {
    "session.started": () => {
      const url = process.env.MCP_SERVER_URL;
      if (!url) return null;
      return defineMcpClientConnection({
        description: "Tools exposed by the configured MCP server.",
        url,
      });
    },
  },
});
