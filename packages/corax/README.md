# Corax

A self-hosted TypeScript agent framework and CLI for **Node.js 24+**.
Corax discovers agent modules, compiles them, and runs durable sessions with
tools, memory, channels, schedules, sandboxes and subagents.

## Install

```sh
npm install @coraxjs/core @ai-sdk/openai
```

```ts
// agent.ts
import { createOpenAI } from "@ai-sdk/openai";
import { defineAgent } from "@coraxjs/core";

const provider = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
export default defineAgent({
  model: provider.chat("gpt-5.4"),
  modelContextWindowTokens: 400_000,
});
```

Add `OPENAI_API_KEY` to `.env`, write `instructions.md`, then run:

```sh
npx corax dev
# Production:
npx corax build
npx corax start
# Connect from another interactive terminal:
npx --package=@coraxjs/core corax remote connect --url http://localhost:3000
```

The package includes JavaScript, TypeScript declarations and the `corax` command.
The npm package is `@coraxjs/core`; the executable remains `corax`.
Import the SDK through `@coraxjs/core` and its public subpaths such as
`@coraxjs/core/client`, `@coraxjs/core/tools`, `@coraxjs/core/memory/file`
and `@coraxjs/core/channels/corax`.

Project modules configure authentication. Remote clients can pass explicit
`--header "Authorization: Bearer TOKEN"` headers or URL Basic credentials.
Local state defaults to `.corax/`; production builds live in `.output/`.
`start` runs an existing build, so rebuild after updating the framework or agent.

See the [repository](https://github.com/lengjing/corax),
[examples](https://github.com/lengjing/corax/tree/main/examples), and
[documentation](https://github.com/lengjing/corax#readme).

Based on eve 0.79.1. Apache-2.0; see LICENSE and NOTICE for upstream attribution.
