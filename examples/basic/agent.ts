import { createOpenAI } from "@ai-sdk/openai";
import { defineAgent } from "corax";

const provider = createOpenAI({
  name: "corax",
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
});

export default defineAgent({
  model: provider.chat(process.env.CORAX_MODEL || "gpt-4.1-mini"),
  modelContextWindowTokens: Number(process.env.CORAX_CONTEXT_WINDOW || "128000"),
  experimental: { workflow: { world: "local" } },
});
