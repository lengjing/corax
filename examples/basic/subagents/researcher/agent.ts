import { createOpenAI } from "@ai-sdk/openai";
import { defineAgent } from "corax";

const provider = createOpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
});

// `description` is required for subagents: it is how the root agent decides
// when to delegate. The directory name `researcher` is the subagent id.
export default defineAgent({
  description: "Gathers background facts on a topic and returns a sourced summary.",
  model: provider.chat(process.env.CORAX_MODEL || "deepseek-flash"),
  modelContextWindowTokens: Number(process.env.CORAX_CONTEXT_WINDOW || "128000"),
});
