import { joinCoraxRoutePath } from "#shared/corax-route-path.js";

/** Joins an corax route to a remote agent base URL without dropping its path prefix. */
export function createRemoteAgentRouteUrl(baseUrl: string, routePath: string): string {
  const route = new URL(routePath, "http://corax.local");
  const url = new URL(baseUrl);
  url.pathname = joinCoraxRoutePath(url.pathname, route.pathname);
  url.search = route.search;
  url.hash = route.hash;
  return url.toString();
}
