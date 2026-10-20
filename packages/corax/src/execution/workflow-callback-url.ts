import { joinCoraxRoutePath } from "#shared/corax-route-path.js";
import {
  CORAX_PUBLIC_ROUTE_PREFIX_ENV,
  normalizePublicRoutePrefix,
} from "#shared/public-route-prefix.js";

const WORKFLOW_LOCAL_BASE_URL_ENV = "WORKFLOW_LOCAL_BASE_URL";

/**
 * Resolves the base URL used for framework-owned workflow callbacks.
 *
 * Workflow metadata falls back to port 3000 when its optional local port
 * discovery is unavailable. corax already configures the local world with the
 * active dev-server origin, so prefer that value before the metadata fallback.
 *
 * When {@link CORAX_PUBLIC_ROUTE_PREFIX_ENV} is set (baked into deployed
 * workflow functions for named multi-agent mounts), the prefix is
 * appended so callbacks built from this base resolve to the agent's public
 * `<prefix>/corax/v1/*` mount instead of the bare `/corax/v1/*` path the origin
 * does not serve.
 */
export function resolveWorkflowCallbackBaseUrl(metadataUrl: string): string {
  const configuredLocalBaseUrl = process.env[WORKFLOW_LOCAL_BASE_URL_ENV]?.trim();
  const localBaseUrl = configuredLocalBaseUrl ? configuredLocalBaseUrl : undefined;
  const resolved = localBaseUrl ?? metadataUrl;
  const baseUrl = resolved.replace(/\/$/, "");
  const publicRoutePrefix = normalizePublicRoutePrefix(process.env[CORAX_PUBLIC_ROUTE_PREFIX_ENV]);
  return publicRoutePrefix === undefined ? baseUrl : `${baseUrl}${publicRoutePrefix}`;
}

/**
 * Builds a framework-owned callback URL that a browser or third party sees,
 * such as the connection sign-in redirect handed to an IdP.
 *
 * `callbackPath` is appended to the full base URL rather than resolved
 * against it: the base may carry a public route prefix path, which
 * `new URL(path, base)` would drop for absolute paths.
 */
export function createBrowserCallbackUrl(baseUrl: string, callbackPath: string): string {
  const callback = new URL(callbackPath, "http://corax.local");
  const url = new URL(baseUrl);
  url.pathname = joinCoraxRoutePath(url.pathname, callback.pathname);
  url.search = callback.search;
  return url.toString();
}

/**
 * Builds a framework-owned callback URL for server-to-server delivery. It is
 * currently identical to {@link createBrowserCallbackUrl}; the distinction is
 * kept so hosts can attach transport-specific credentials in one place.
 */
export function createWorkflowCallbackUrl(baseUrl: string, callbackPath: string): string {
  return createBrowserCallbackUrl(baseUrl, callbackPath);
}
