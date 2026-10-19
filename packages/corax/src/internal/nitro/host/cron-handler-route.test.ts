import type { Nitro } from "nitro/types";
import { describe, expect, it } from "vitest";

import { CORAX_ROUTE_PREFIX } from "#protocol/routes.js";
import {
  applyCoraxCronHandlerRoute,
  createCoraxCronHandlerRoute,
} from "#internal/nitro/host/cron-handler-route.js";

// 32 random bytes encoded as base64url (no padding) → 43 characters.
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;

describe("createCoraxCronHandlerRoute", () => {
  it("returns a route under the corax protocol prefix with a random base64url suffix", () => {
    const route = createCoraxCronHandlerRoute();

    expect(route.startsWith(`${CORAX_ROUTE_PREFIX}/cron/`)).toBe(true);

    const suffix = route.slice(`${CORAX_ROUTE_PREFIX}/cron/`.length);
    expect(suffix).toMatch(BASE64URL_PATTERN);
  });

  it("emits a unique route on every call", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 100; index += 1) {
      seen.add(createCoraxCronHandlerRoute());
    }

    expect(seen.size).toBe(100);
  });
});

describe("applyCoraxCronHandlerRoute", () => {
  it("replaces the Vercel preset's default cron handler route", () => {
    const nitro = createNitroStub({ vercel: { cronHandlerRoute: "/_vercel/cron" } });

    applyCoraxCronHandlerRoute(nitro);

    expect(nitro.options.vercel?.cronHandlerRoute).not.toBe("/_vercel/cron");
    expect(nitro.options.vercel?.cronHandlerRoute?.startsWith(`${CORAX_ROUTE_PREFIX}/cron/`)).toBe(
      true,
    );
  });

  it("populates the route even when the preset has not initialized one yet", () => {
    const nitro = createNitroStub({ vercel: {} });

    applyCoraxCronHandlerRoute(nitro);

    expect(nitro.options.vercel?.cronHandlerRoute?.startsWith(`${CORAX_ROUTE_PREFIX}/cron/`)).toBe(
      true,
    );
  });

  it("is a no-op when the Vercel preset is not in use", () => {
    const nitro = createNitroStub({});

    applyCoraxCronHandlerRoute(nitro);

    expect(nitro.options.vercel).toBeUndefined();
  });
});

function createNitroStub(input: { vercel?: { cronHandlerRoute?: string } }): Nitro {
  return {
    options: {
      vercel: input.vercel,
    },
  } as unknown as Nitro;
}
