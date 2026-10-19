import { CORAX_ROUTE_PREFIX } from "#protocol/routes.js";

const CORAX_NAMED_AGENT_MOUNT_PATTERN = /^\/corax\/[a-z0-9][a-z0-9_-]*$/;
const CORAX_NAMED_AGENT_PROTOCOL_PATTERN = /^\/corax\/[a-z0-9][a-z0-9_-]*\/v1$/;

/** Joins an internal corax route to a public target, including compact named-agent mounts. */
export function joinCoraxRoutePath(basePath: string, routePath: string): string {
  const base = trimTrailingSlash(basePath);
  const route = routePath.startsWith("/") ? routePath : `/${routePath}`;
  if (route === CORAX_ROUTE_PREFIX || route.startsWith(`${CORAX_ROUTE_PREFIX}/`)) {
    if (CORAX_NAMED_AGENT_MOUNT_PATTERN.test(base)) {
      return `${base}${route.slice("/corax".length)}`;
    }
    if (CORAX_NAMED_AGENT_PROTOCOL_PATTERN.test(base)) {
      return `${base}${route.slice(CORAX_ROUTE_PREFIX.length)}`;
    }
  }
  return `${base}${route}`;
}

/** Maps a compact named-agent route back to the internal corax protocol namespace. */
export function normalizePublicCoraxRoutePath(path: string): string {
  return path.replace(/^\/corax\/[a-z0-9][a-z0-9_-]*\/v1(?=\/|$)/, CORAX_ROUTE_PREFIX);
}

function trimTrailingSlash(value: string): string {
  if (value === "/") return "";
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
