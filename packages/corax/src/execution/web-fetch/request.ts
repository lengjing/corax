import { lookup } from "node:dns";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";

import type { Agent, Response as UndiciResponse } from "undici";

import { isLoopbackHostname, isPrivateOrReservedIpAddress } from "#shared/network-address.js";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 10;
const UNSAFE_DESTINATION_ERROR =
  "URL must not target localhost, private, link-local, or reserved IP addresses.";

/** Options for an SSRF-safe HTTPS request. */
interface PublicUrlRequestOptions {
  readonly headers: Readonly<Record<string, string>>;
  readonly maxResponseSize: number;
  readonly signal: AbortSignal;
}

/**
 * Requests an untrusted HTTPS URL while preventing access to non-public
 * network destinations.
 *
 * The socket lookup rejects the hostname if any resolved address is non-public
 * and connects using those exact results.
 */
export async function requestPublicUrl(
  urlText: string,
  options: PublicUrlRequestOptions,
): Promise<Response> {
  let url = parseHttpsUrl(urlText);

  for (let redirectCount = 0; ; redirectCount++) {
    const { agent, response } = await requestOnce(url, options);

    try {
      const location = response.headers.get("location");

      if (
        location !== null &&
        REDIRECT_STATUSES.has(response.status) &&
        redirectCount < MAX_REDIRECTS
      ) {
        await cancelResponseBody(response);
        url = parseHttpsUrl(new URL(location, url).toString());
        continue;
      }

      return await consumeResponse(response, options.maxResponseSize);
    } finally {
      await agent.close();
    }
  }
}

/**
 * Bun maps the bare `undici` specifier to its own stub, whose `Agent` cannot
 * dispatch and whose `fetch` is the native one that ignores `dispatcher`. The
 * package entry file bypasses that mapping so the pinned-DNS connector
 * actually carries the request.
 */
function loadUndici() {
  return import("undici/index.js");
}

function parseHttpsUrl(urlText: string): URL {
  let url: URL;

  try {
    url = new URL(urlText);
  } catch {
    throw new Error("URL must be a valid absolute https:// URL.");
  }

  if (url.protocol !== "https:") {
    throw new Error("URL must start with https://");
  }

  return url;
}

async function requestOnce(
  url: URL,
  options: PublicUrlRequestOptions,
): Promise<{ readonly agent: Agent; readonly response: UndiciResponse }> {
  assertPublicHostname(url.hostname);
  const { Agent, fetch } = await loadUndici();
  const agent = new Agent({
    connect: {
      lookup: createPublicLookup(),
    },
  });

  try {
    const response = await fetch(url, {
      dispatcher: agent,
      headers: options.headers,
      redirect: "manual",
      signal: options.signal,
    });
    return { agent, response };
  } catch (error) {
    await agent.close();
    throw unwrapFetchFailure(error);
  }
}

/**
 * undici reports every dispatch failure as `TypeError: fetch failed` and
 * keeps the reason (DNS, policy, socket) on `cause`; surface that instead.
 */
function unwrapFetchFailure(error: unknown): unknown {
  return error instanceof TypeError && error.message === "fetch failed" && error.cause !== undefined
    ? error.cause
    : error;
}

function assertPublicHostname(hostname: string): void {
  const normalizedHostname = hostname.replace(/^\[(.*)\]$/u, "$1");
  const family = isIP(normalizedHostname);

  if (family !== 0) {
    assertPublicAddress(normalizedHostname);
    return;
  }

  if (isLoopbackHostname(normalizedHostname)) {
    throw new Error(UNSAFE_DESTINATION_ERROR);
  }
}

function assertPublicAddress(address: string, hostname?: string): void {
  if (!isPrivateOrReservedIpAddress(address)) return;
  throw new Error(
    hostname === undefined
      ? UNSAFE_DESTINATION_ERROR
      : `${UNSAFE_DESTINATION_ERROR} ("${hostname}" resolved to ${address}.)`,
  );
}

function createPublicLookup(): LookupFunction {
  return (hostname, lookupOptions, callback) => {
    lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error !== null) {
        callback(error, "", 0);
        return;
      }

      try {
        for (const { address } of addresses) {
          assertPublicAddress(address, hostname);
        }
      } catch (error) {
        callback(error as Error, "", 0);
        return;
      }

      const matchingAddresses =
        lookupOptions.family === undefined || lookupOptions.family === 0
          ? addresses
          : addresses.filter(({ family }) => family === lookupOptions.family);

      if (matchingAddresses.length === 0) {
        const error = new Error(
          `Unable to resolve URL hostname "${hostname}" in the requested IP family.`,
        );
        Object.assign(error, { code: "ENOTFOUND" });
        callback(error, "", 0);
        return;
      }

      if (lookupOptions.all === true) {
        callback(null, matchingAddresses);
        return;
      }

      const selected = matchingAddresses[0]!;
      callback(null, selected.address, selected.family);
    });
  };
}

async function consumeResponse(
  response: UndiciResponse,
  maxResponseSize: number,
): Promise<Response> {
  const declaredLength = parseContentLength(response.headers.get("content-length"));

  if (declaredLength !== undefined && declaredLength > maxResponseSize) {
    await cancelResponseBody(response);
    throw createResponseTooLargeError(maxResponseSize);
  }

  const body = await readBoundedBody(response, maxResponseSize);
  const responseBody = body.byteLength === 0 ? null : Uint8Array.from(body).buffer;

  return new Response(responseBody, {
    headers: Array.from(response.headers),
    status: response.status,
    statusText: response.statusText,
  });
}

function parseContentLength(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

async function readBoundedBody(
  response: UndiciResponse,
  maxResponseSize: number,
): Promise<Uint8Array> {
  if (response.body === null) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      byteLength += value.byteLength;
      if (byteLength > maxResponseSize) {
        await reader.cancel();
        throw createResponseTooLargeError(maxResponseSize);
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function cancelResponseBody(response: UndiciResponse): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The connection will still be closed with its per-request agent.
  }
}

function createResponseTooLargeError(maxResponseSize: number): Error {
  return new Error(`Response too large (exceeds ${maxResponseSize} bytes).`);
}
