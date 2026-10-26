import { createOpenAI } from "@ai-sdk/openai";
import { defineAgent } from "corax";

const provider = createOpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
});

export default defineAgent({
  model: provider.chat(process.env.CORAX_MODEL || "deepseek-flash"),
  modelContextWindowTokens: Number(process.env.CORAX_CONTEXT_WINDOW || "128000"),
  experimental: { workflow: { world: "local" } },
});
