import { resolve } from "node:path";

import {
  createCoraxPublicRoute,
  createCoraxRequestPathRoute,
  createCoraxServiceName,
  type CoraxVercelAgentTarget,
} from "#internal/vercel/corax-service-contribution.js";
import {
  createServiceConfigRecord,
  type VercelRouteConfig,
  type VercelServiceConfig,
  type VercelServicesCollection,
  type VercelServicesConfig,
} from "#internal/vercel/vercel-services-config.js";
import { parseJsonObject, type JsonValue } from "#shared/json.js";

export function resolveServicePrefix(service: VercelServiceConfig | undefined): string | undefined {
  if (typeof service?.routePrefix === "string" && service.routePrefix.trim().length > 0) {
    return service.routePrefix.trim();
  }
  if (typeof service?.mount === "string" && service.mount.trim().length > 0) {
    return service.mount.trim();
  }
  if (
    typeof service?.mount === "object" &&
    typeof service.mount.path === "string" &&
    service.mount.path.trim().length > 0
  ) {
    return service.mount.path.trim();
  }
  return undefined;
}

function parseLegacyServiceCollection(
  value: JsonValue | undefined,
): readonly VercelServiceConfig[] | undefined {
  if (value === undefined) return undefined;
  let entries: readonly JsonValue[];
  try {
    entries = Array.isArray(value) ? value : Object.values(parseJsonObject(value));
  } catch {
    return undefined;
  }
  return entries.flatMap((entry) => {
    try {
      return [parseJsonObject(entry) as VercelServiceConfig];
    } catch {
      return [];
    }
  });
}

function createServiceConfigList(
  services: VercelServicesCollection | undefined,
): readonly VercelServiceConfig[] | undefined {
  return services === undefined ? undefined : Object.values(createServiceConfigRecord(services));
}

function resolveServiceRoot(configRoot: string, service: VercelServiceConfig): string | undefined {
  const root = service.root ?? service.entrypoint;
  return typeof root === "string" && root.trim().length > 0 ? resolve(configRoot, root) : undefined;
}

function resolveServiceCollection(
  config: VercelServicesConfig,
): readonly VercelServiceConfig[] | undefined {
  return (
    parseLegacyServiceCollection(config.experimentalServices) ??
    parseLegacyServiceCollection(config.experimentalServicesV2) ??
    createServiceConfigList(config.services)
  );
}

/** Resolve the mounted prefix for the corax service matching an application root. */
export function resolveCoraxServicePrefixByRoot(input: {
  readonly appRoots: readonly string[];
  readonly config: VercelServicesConfig;
  readonly configRoot: string;
}): string | undefined {
  for (const service of resolveServiceCollection(input.config) ?? []) {
    const prefix = resolveServicePrefix(service);
    if (
      service.framework === "corax" &&
      prefix !== undefined &&
      prefix !== "/" &&
      input.appRoots.includes(resolveServiceRoot(input.configRoot, service) ?? "")
    ) {
      return prefix;
    }
  }
  return undefined;
}

export function findConfiguredCoraxServiceEntry(
  services: Record<string, VercelServiceConfig>,
  agent: CoraxVercelAgentTarget,
): { readonly name: string; readonly service: VercelServiceConfig } | undefined {
  if (agent.name !== undefined) {
    const name = createCoraxServiceName(agent.name);
    const service = services[name];
    return service?.framework === "corax" ? { name, service } : undefined;
  }
  const entry = Object.entries(services).find(([, service]) => service.framework === "corax");
  return entry === undefined ? undefined : { name: entry[0], service: entry[1] };
}

export function insertCoraxServiceRequestPathRoute(
  routes: readonly VercelRouteConfig[] | undefined,
  routeSrc: string,
): readonly VercelRouteConfig[] {
  return [
    createCoraxRequestPathRoute(routeSrc),
    ...(routes ?? []).filter((route) => route.src !== routeSrc),
  ];
}

function isCoraxServiceRoute(
  route: VercelRouteConfig,
  serviceName: string,
  routeSrc: string,
): boolean {
  const destination = route.destination;
  return (
    route.src === routeSrc &&
    typeof destination === "object" &&
    destination.type === "service" &&
    destination.service === serviceName
  );
}

export function insertCoraxServiceRoutes(
  routes: readonly VercelRouteConfig[],
  coraxRoutes: readonly { readonly routeSrc: string; readonly serviceName: string }[],
): readonly VercelRouteConfig[] {
  const retained = routes.filter(
    (route) =>
      !coraxRoutes.some(({ routeSrc, serviceName }) =>
        isCoraxServiceRoute(route, serviceName, routeSrc),
      ),
  );
  const generated = coraxRoutes.map(({ routeSrc, serviceName }) =>
    createCoraxPublicRoute(serviceName, routeSrc),
  );
  const filesystemIndex = retained.findIndex((route) => route.handle === "filesystem");
  return filesystemIndex < 0
    ? [...generated, ...retained]
    : [...retained.slice(0, filesystemIndex), ...generated, ...retained.slice(filesystemIndex)];
}
