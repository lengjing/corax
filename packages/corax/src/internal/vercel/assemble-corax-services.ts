import {
  compileCoraxVercelService,
  type CoraxVercelAgentTarget,
  type CoraxVercelBuildTarget,
} from "#internal/vercel/corax-service-contribution.js";
import {
  findConfiguredCoraxServiceEntry,
  insertCoraxServiceRequestPathRoute,
  insertCoraxServiceRoutes,
} from "#internal/vercel/vercel-service-config-operations.js";
import type {
  VercelRouteConfig,
  VercelServiceConfig,
} from "#internal/vercel/vercel-services-config.js";

interface CoraxVercelServiceTarget {
  readonly agent: CoraxVercelAgentTarget;
  readonly target: CoraxVercelBuildTarget;
}

interface AssembledCoraxVercelServices {
  readonly rootDirectories: readonly string[];
  readonly routes: readonly VercelRouteConfig[];
  readonly services: Readonly<Record<string, VercelServiceConfig>>;
}

/** Merge corax agents into one Vercel service graph. */
export function assembleCoraxVercelServices(input: {
  readonly agents: readonly CoraxVercelServiceTarget[];
  readonly routes?: readonly VercelRouteConfig[];
  readonly services?: Readonly<Record<string, VercelServiceConfig>>;
}): AssembledCoraxVercelServices {
  const existingServices = input.services ?? {};
  const services: Record<string, VercelServiceConfig> = { ...existingServices };
  const rootDirectories: string[] = [];
  const coraxRoutes: { routeSrc: string; serviceName: string }[] = [];

  for (const { agent, target } of input.agents) {
    const contribution = compileCoraxVercelService({ agent, target });
    const configured = findConfiguredCoraxServiceEntry(existingServices, agent);
    const serviceName = configured?.name ?? contribution.serviceName;

    if (configured === undefined) rootDirectories.push(contribution.rootDirectory);
    services[serviceName] =
      configured === undefined
        ? contribution.service
        : {
            ...configured.service,
            routes: insertCoraxServiceRequestPathRoute(
              configured.service.routes,
              contribution.routeSrc,
            ),
          };
    coraxRoutes.push({ routeSrc: contribution.routeSrc, serviceName });
    if (contribution.homeRouteSrc !== undefined) {
      coraxRoutes.push({ routeSrc: contribution.homeRouteSrc, serviceName });
    }
  }

  return {
    rootDirectories,
    routes: insertCoraxServiceRoutes(input.routes ?? [], coraxRoutes),
    services,
  };
}
