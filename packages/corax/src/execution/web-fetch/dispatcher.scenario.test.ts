import { createServer } from "node:http";

import { describe, expect, it } from "vitest";

describe("undici runtime compatibility", () => {
  it("routes the package's fetch through a custom agent lookup under Bun", async () => {
    const server = createServer((_request, response) => {
      response.end("pinned response");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected an ephemeral TCP listener.");
    }

    // The bare `undici` specifier resolves to Bun's stub, so this is the same
    // entry file the web-fetch request path loads.
    const { Agent, fetch } = await import("undici/index.js");
    const resolved: string[] = [];
    const agent = new Agent({
      connect: {
        lookup: (hostname, options, callback) => {
          resolved.push(hostname);
          if (options.all === true) callback(null, [{ address: "127.0.0.1", family: 4 }]);
          else callback(null, "127.0.0.1", 4);
        },
      },
    });

    try {
      const response = await fetch(`http://pinned.invalid:${address.port}`, { dispatcher: agent });

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("pinned response");
      expect(resolved).toEqual(["pinned.invalid"]);
    } finally {
      await agent.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    }
  });
});
