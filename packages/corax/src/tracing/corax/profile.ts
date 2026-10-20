import type { Attributes, OutputMapping } from "#compiled/corax-tracing/index.js";

export function coraxOutputMapping(): OutputMapping {
  return {
    attributes(span, attributes) {
      const output: Record<string, Attributes[string]> = {};
      for (const [key, value] of Object.entries(attributes)) {
        if (key === "agent.connection.name") output["corax.connection.name"] = value;
        else if (span.type === "channelRequest" && key === "agent.channel.name")
          output["corax.channel.name"] = value;
        else if (span.type === "channelRequest" && key === "agent.channel.kind")
          output["corax.channel.kind"] = value;
        else output[key] = value;
      }
      return output;
    },
    link: (_span, link) => ({
      "corax.link.type":
        link.relationship === "execution.delivery" ? "workflow.delivery" : link.relationship,
    }),
  };
}