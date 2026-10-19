export const CORAX_SHARED_SERVER_FUNCTION_PATH = "corax/__server.func";

/** Route Nitro's Vercel preset emits as the queue-triggered workflow function. */
export const CORAX_WORKFLOW_FLOW_ROUTE_PATH = "/.well-known/workflow/v1/flow";

const CORAX_SHARED_SERVER_ROUTE_DESTINATION = "/corax/__server";
const CORAX_VERCEL_FUNCTION_PREFIXES = ["corax/", ".well-known/workflow/"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isCoraxVercelFunctionPath(path: string): boolean {
  return CORAX_VERCEL_FUNCTION_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function normalizeCoraxVercelRoutes(
  routes: readonly unknown[],
  _servicePrefix: string | undefined,
): unknown[] {
  return routes.filter(isCoraxVercelRoute).map(normalizeCoraxVercelRoute);
}

function isCoraxVercelRoute(route: unknown): boolean {
  if (!isRecord(route)) {
    return true;
  }

  if ("handle" in route) {
    return true;
  }

  const src = typeof route.src === "string" ? route.src : "";
  const dest = typeof route.dest === "string" ? route.dest : "";

  return isCoraxVercelRoutePath(src) || isCoraxVercelRoutePath(dest);
}

function isCoraxVercelRoutePath(path: string): boolean {
  return path.includes("/corax/v1") || path.includes("/.well-known/workflow/");
}

function isCoraxProtocolRoutePath(path: string): boolean {
  return path.includes("/corax/v1");
}

function normalizeCoraxVercelRoute(route: unknown): unknown {
  if (!isRecord(route) || "handle" in route || typeof route.src !== "string") {
    return route;
  }

  const shouldUseSharedServerFunction =
    isCoraxProtocolRoutePath(route.src) ||
    (typeof route.dest === "string" && isCoraxProtocolRoutePath(route.dest));
  const nextRoute: Record<string, unknown> = {
    ...route,
  };

  if (shouldUseSharedServerFunction) {
    nextRoute.dest = CORAX_SHARED_SERVER_ROUTE_DESTINATION;
  }

  return nextRoute;
}
