import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { shellQuote } from "#shared/shell-quote.js";

import {
  CORAX_INTERNAL_BUILD_OUTPUT_DIRECTORY_ENV,
  CORAX_INTERNAL_HOST_BUILD_OUTPUT_DIRECTORY_ENV,
} from "#internal/application/paths.js";
import { CORAX_ROUTE_PREFIX } from "#protocol/routes.js";
import { resolveCoraxBinaryPath } from "#shared/resolve-corax-binary.js";
import { findClosestLinkedVercelDirectory } from "#shared/vercel-output-directory.js";

const VERCEL_JSON_FILE_NAME = "vercel.json";
const CORAX_SERVICE_NAME = "corax";
const CORAX_SERVICE_ROUTE_SRC = `^${CORAX_ROUTE_PREFIX}/(.*)$`;
const CORAX_SERVICE_ROUTE_PATH = `${CORAX_ROUTE_PREFIX}/$1`;
const CORAX_VERCEL_SERVICES_DIRECTORY = ".corax/vercel-services";

interface VercelRequestPathTransform {
  readonly args: string;
  readonly op: "set";
  readonly type: "request.path";
}

interface VercelServiceRouteDestination {
  readonly service?: string;
  readonly type?: string;
}

interface VercelRouteConfig {
  readonly destination?: string | VercelServiceRouteDestination;
  readonly handle?: string;
  readonly src?: string;
  readonly transforms?: readonly VercelRequestPathTransform[];
  readonly [key: string]: unknown;
}

interface VercelServiceConfig {
  readonly framework?: string;
  readonly routes?: readonly VercelRouteConfig[];
  readonly [key: string]: unknown;
}

interface VercelNamedServiceConfig extends VercelServiceConfig {
  readonly name?: string;
}

type VercelServicesCollection =
  | Record<string, VercelServiceConfig>
  | readonly VercelNamedServiceConfig[];

interface VercelJsonConfig {
  readonly experimentalServices?: unknown;
  readonly services?: VercelServicesCollection;
  readonly [key: string]: unknown;
}

/**
 * The top-level Vercel Build Output route that sends corax transport requests to
 * the generated corax service.
 */
type CoraxVercelServiceRoute = {
  readonly destination: {
    readonly service: string;
    readonly type: "service";
  };
  readonly src: string;
};

/**
 * A service-scoped route carrying the `request.path` transform that pins the
 * path the corax runtime observes to the corax transport namespace.
 */
type CoraxVercelServiceRequestPathRoute = {
  readonly src: string;
  readonly transforms: readonly [VercelRequestPathTransform];
};

/**
 * The generated corax service entry written into the Vercel Build Output
 * `services` record.
 */
export type CoraxVercelGeneratedService = {
  readonly buildCommand: string;
  readonly framework: "corax";
  readonly outputDirectory: ".vercel/output";
  readonly routes: readonly VercelRouteConfig[];
  readonly root: string;
};

/**
 * Minimal shape of a Vercel Build Output config that can carry generated corax
 * services.
 */
export interface VercelBuildConfig {
  version?: number;
  routes?: unknown[];
  services?: Record<string, VercelServiceConfig>;
  [key: string]: unknown;
}

/**
 * Result of {@link ensureCoraxVercelServicesConfig}: `root` when `vercel.json`
 * already declares stable services (the user owns routing; nothing is
 * generated), `generated` with the service record to merge into a Vercel Build
 * Output config otherwise.
 */
export type EnsureCoraxVercelServicesConfigResult =
  | { readonly mode: "root" }
  | {
      readonly mode: "generated";
      readonly services: Record<string, CoraxVercelGeneratedService>;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toPosixRelative(from: string, to: string): string {
  const relativePath = relative(from, to);
  return relativePath.length === 0 ? "." : relativePath.replaceAll("\\", "/");
}

function isNamedServiceConfigArray(
  services: VercelServicesCollection,
): services is readonly VercelNamedServiceConfig[] {
  return Array.isArray(services);
}

function createServiceConfigRecord(
  services: VercelServicesCollection | undefined,
): Record<string, VercelServiceConfig> {
  if (services === undefined) {
    return {};
  }

  if (isNamedServiceConfigArray(services)) {
    const record: Record<string, VercelServiceConfig> = {};

    for (const service of services) {
      if (typeof service.name === "string" && service.name.trim().length > 0) {
        const { name, ...serviceConfig } = service;
        record[name] = serviceConfig;
      }
    }

    return record;
  }

  return services;
}

function normalizeVercelJsonConfig(value: unknown): VercelJsonConfig {
  if (!isRecord(value)) {
    throw new Error(`${VERCEL_JSON_FILE_NAME} must contain a JSON object.`);
  }

  const services = value.services;

  if (
    services !== undefined &&
    !isRecord(services) &&
    !(
      Array.isArray(services) &&
      services.every(
        (service) =>
          isRecord(service) && typeof service.name === "string" && service.name.trim().length > 0,
      )
    )
  ) {
    throw new Error(
      `${VERCEL_JSON_FILE_NAME} services must be a JSON object or named service array.`,
    );
  }

  return value as VercelJsonConfig;
}

async function readVercelJsonConfig(path: string): Promise<VercelJsonConfig> {
  try {
    return normalizeVercelJsonConfig(JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

function findCoraxService(
  services: Record<string, VercelServiceConfig>,
): VercelServiceConfig | undefined {
  return Object.values(services).find((service) => service.framework === "corax");
}

function assertRootServicesIncludeCorax(
  services: Record<string, VercelServiceConfig>,
  frameworkName: string,
): void {
  if (findCoraxService(services) === undefined) {
    throw new Error(
      `${VERCEL_JSON_FILE_NAME} already defines services, so the corax ${frameworkName} integration cannot add a generated corax service. Add an corax service (framework "corax") and a rewrite from ${CORAX_ROUTE_PREFIX}/(.*) to it in ${VERCEL_JSON_FILE_NAME}, or remove services from ${VERCEL_JSON_FILE_NAME}.`,
    );
  }
}

/**
 * Build the top-level Build Output route that exposes the corax service on the
 * corax transport namespace (`/corax/v1/*`).
 */
export function createCoraxServiceRoute(
  serviceName: string = CORAX_SERVICE_NAME,
): CoraxVercelServiceRoute {
  return {
    destination: {
      service: serviceName,
      type: "service",
    },
    src: CORAX_SERVICE_ROUTE_SRC,
  };
}

/**
 * Build the corax service's own route that sets `request.path` so the corax
 * runtime observes the transport path regardless of how the platform routed
 * the request into the service.
 */
export function createCoraxServiceRequestPathRoute(): CoraxVercelServiceRequestPathRoute {
  return {
    src: CORAX_SERVICE_ROUTE_SRC,
    transforms: [
      {
        args: CORAX_SERVICE_ROUTE_PATH,
        op: "set",
        type: "request.path",
      },
    ],
  };
}

function isCoraxServiceRoute(route: VercelRouteConfig, serviceName: string): boolean {
  const destination = route.destination;

  return (
    route.src === CORAX_SERVICE_ROUTE_SRC &&
    isRecord(destination) &&
    destination.type === "service" &&
    destination.service === serviceName
  );
}

function insertCoraxServiceRoute(routes: readonly unknown[], serviceName: string): unknown[] {
  const routesWithoutCoraxRoute = routes.filter(
    (route) => !(isRecord(route) && isCoraxServiceRoute(route, serviceName)),
  );
  const filesystemRouteIndex = routesWithoutCoraxRoute.findIndex(
    (route) => isRecord(route) && route.handle === "filesystem",
  );

  if (filesystemRouteIndex === -1) {
    return [createCoraxServiceRoute(serviceName), ...routesWithoutCoraxRoute];
  }

  return [
    ...routesWithoutCoraxRoute.slice(0, filesystemRouteIndex),
    createCoraxServiceRoute(serviceName),
    ...routesWithoutCoraxRoute.slice(filesystemRouteIndex),
  ];
}

function insertCoraxServiceRequestPathRoute(
  routes: readonly VercelRouteConfig[] | undefined,
): readonly VercelRouteConfig[] {
  const routesWithoutGeneratedRoute = (routes ?? []).filter(
    (route) => route.src !== CORAX_SERVICE_ROUTE_SRC,
  );

  return [createCoraxServiceRequestPathRoute(), ...routesWithoutGeneratedRoute];
}

function createGeneratedServiceBuild(input: {
  readonly appRoot: string;
  readonly coraxBuildCommand?: string;
  readonly hostRoot: string;
}): { readonly buildCommand: string; readonly root: string; readonly rootDirectory: string } {
  const rootDirectory = join(input.hostRoot, CORAX_VERCEL_SERVICES_DIRECTORY, CORAX_SERVICE_NAME);
  const outputDirectory = join(rootDirectory, ".vercel", "output");
  const hostOutputDirectory = join(input.hostRoot, ".vercel", "output");
  const workingDirectory = toPosixRelative(rootDirectory, input.appRoot);
  const configuredOutputDirectory = toPosixRelative(input.appRoot, outputDirectory);
  const configuredHostOutputDirectory = toPosixRelative(input.appRoot, hostOutputDirectory);
  const buildCommand =
    input.coraxBuildCommand ??
    `node ${shellQuote(toPosixRelative(input.appRoot, resolveCoraxBinaryPath(input.hostRoot)))} build`;

  return {
    buildCommand: `cd ${shellQuote(workingDirectory)} && export ${CORAX_INTERNAL_BUILD_OUTPUT_DIRECTORY_ENV}=${shellQuote(configuredOutputDirectory)} && export ${CORAX_INTERNAL_HOST_BUILD_OUTPUT_DIRECTORY_ENV}=${shellQuote(configuredHostOutputDirectory)} && ${buildCommand}`,
    root: toPosixRelative(input.hostRoot, rootDirectory),
    rootDirectory,
  };
}

/**
 * Resolve the stable Vercel services configuration for a framework + corax
 * deployment.
 *
 * When `vercel.json` (looked up from the linked Vercel project root, falling
 * back to the host root) already declares stable `services`, it must include
 * an corax service and the module generates nothing. Otherwise this prepares a
 * generated corax service — creating its isolated build root under
 * `.corax/vercel-services/corax` so the corax build output cannot collide with the
 * host Build Output — and returns the service record plus the public service
 * route for the caller to merge into its Vercel build config. A legacy
 * `experimentalServices` field is ignored with a migration warning: Vercel no
 * longer routes it.
 */
export async function ensureCoraxVercelServicesConfig(input: {
  readonly appRoot: string;
  readonly coraxBuildCommand?: string;
  readonly frameworkName: string;
  readonly hostRoot: string;
}): Promise<EnsureCoraxVercelServicesConfigResult> {
  const vercelDirectory = await findClosestLinkedVercelDirectory(input.hostRoot);
  const projectRoot = vercelDirectory === undefined ? input.hostRoot : dirname(vercelDirectory);
  // With a Vercel Root Directory, vercel.json lives in the root directory
  // (the host root) while the .vercel link lives at the repository root, so
  // the host root declaration wins over the linked project root's.
  const hostRootVercelConfig = await readVercelJsonConfig(
    join(input.hostRoot, VERCEL_JSON_FILE_NAME),
  );
  const rootVercelConfig =
    projectRoot === input.hostRoot ||
    Object.keys(createServiceConfigRecord(hostRootVercelConfig.services)).length > 0
      ? hostRootVercelConfig
      : await readVercelJsonConfig(join(projectRoot, VERCEL_JSON_FILE_NAME));
  const rootServices = createServiceConfigRecord(rootVercelConfig.services);

  if (Object.keys(rootServices).length > 0) {
    assertRootServicesIncludeCorax(rootServices, input.frameworkName);
    return { mode: "root" };
  }

  if (rootVercelConfig.experimentalServices !== undefined) {
    console.warn(
      `[corax] ${VERCEL_JSON_FILE_NAME} defines experimentalServices, which Vercel no longer routes. The corax ${input.frameworkName} integration now generates the stable services config automatically — remove experimentalServices from ${VERCEL_JSON_FILE_NAME}.`,
    );
  }

  const generatedServiceBuild = createGeneratedServiceBuild(input);
  await mkdir(generatedServiceBuild.rootDirectory, { recursive: true });

  return {
    mode: "generated",
    services: {
      [CORAX_SERVICE_NAME]: {
        buildCommand: generatedServiceBuild.buildCommand,
        framework: "corax",
        outputDirectory: ".vercel/output",
        routes: [createCoraxServiceRequestPathRoute()],
        root: generatedServiceBuild.root,
      },
    },
  };
}

/**
 * Merge the generated corax service and its public route into a Vercel Build
 * Output config.
 *
 * The service route is inserted before an existing `handle: "filesystem"`
 * route, or prepended when none exists. An corax service already configured by
 * the user is preserved and only gains the `request.path` route; everything
 * else passes through untouched.
 */
export function mergeCoraxVercelConfig(
  existing: VercelBuildConfig | undefined,
  generated: Extract<EnsureCoraxVercelServicesConfigResult, { mode: "generated" }>,
): VercelBuildConfig {
  const existingServices = existing?.services ?? {};
  const configuredCoraxEntry = Object.entries(existingServices).find(
    ([name, service]) => name === CORAX_SERVICE_NAME || service.framework === "corax",
  );
  const serviceName = configuredCoraxEntry?.[0] ?? CORAX_SERVICE_NAME;
  const services = configuredCoraxEntry
    ? {
        ...existingServices,
        [serviceName]: {
          ...configuredCoraxEntry[1],
          routes: insertCoraxServiceRequestPathRoute(configuredCoraxEntry[1].routes),
        },
      }
    : { ...existingServices, ...generated.services };

  return {
    version: 3,
    ...existing,
    routes: insertCoraxServiceRoute(existing?.routes ?? [], serviceName),
    services,
  };
}
