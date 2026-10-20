import type { HeadersValue } from "#client/types.js";
import type { OutboundAuthFn } from "#public/agents/auth.js";
import {
  defineRemoteAgent,
  type RemoteAgentDefinition,
  type RemoteAgentUrl,
} from "#public/definitions/remote-agent.js";
import { normalizePublicRoutePrefix } from "#shared/public-route-prefix.js";
import type { AgentToolExposure } from "#shared/agent-definition.js";

const WORKSPACE_AGENT_NAME = Symbol.for("corax.workspace-agent.name");

type BrandedWorkspaceSubagent = RemoteAgentDefinition & {
  readonly [WORKSPACE_AGENT_NAME]: string;
};

/** Runtime transport for one workspace peer. */
export interface WorkspaceAgentTransport {
  readonly auth?: OutboundAuthFn;
  readonly headers?: HeadersValue;
  readonly url: RemoteAgentUrl;
}

/** A workspace peer exposed as one remote subagent. */
export interface WorkspaceAgentDefinition {
  /** Overrides the peer agent's description in the parent's tool definition. */
  readonly description?: string;
  readonly forwardPrincipal?: boolean;
  /** Name of the peer workspace member, such as `research`. */
  readonly name: string;
  /**
   * How corax exposes this workspace peer to the parent model: `true` lists it
   * as a tool, `"deferred"` makes it a catalog entry the model finds with
   * `corax__search` and calls with `corax__tool`, and `false` keeps it callable only from
   * workflow tools. Defaults to `true`.
   */
  readonly tool?: AgentToolExposure;
  /** Overrides environment-aware workspace routing and service authentication. */
  readonly transport?: WorkspaceAgentTransport;
}

/** Defines one workspace peer as a remote subagent. */
export function defineWorkspaceAgent(definition: WorkspaceAgentDefinition): RemoteAgentDefinition {
  const transport = definition.transport ?? defaultWorkspaceAgentTransport(definition.name);
  const remote = defineRemoteAgent({
    auth: transport.auth,
    description: definition.description ?? "",
    forwardPrincipal: definition.forwardPrincipal,
    headers: transport.headers,
    tool: definition.tool,
    url: transport.url,
  }) as BrandedWorkspaceSubagent;
  Object.defineProperty(remote, WORKSPACE_AGENT_NAME, { value: definition.name });
  return remote;
}

export function workspaceSubagentName(value: unknown): string | undefined {
  return isBrandedWorkspaceSubagent(value) ? value[WORKSPACE_AGENT_NAME] : undefined;
}

function isBrandedWorkspaceSubagent(value: unknown): value is BrandedWorkspaceSubagent {
  return typeof value === "object" && value !== null && Reflect.has(value, WORKSPACE_AGENT_NAME);
}

function workspaceAgentRoutePrefix(name: string): string {
  const callerRoutePrefix = normalizePublicRoutePrefix(process.env.CORAX_PUBLIC_ROUTE_PREFIX);
  const namespace = callerRoutePrefix?.slice(0, callerRoutePrefix.lastIndexOf("/")) ?? "/corax";
  return `${namespace}/${name}`;
}

const WORKSPACE_BASE_URL_ENV = "CORAX_WORKSPACE_BASE_URL";

/**
 * Default transport for a self-hosted workspace: every member is reachable
 * under one shared origin (`CORAX_WORKSPACE_BASE_URL`) at
 * `/corax/<name>/v1/*`. Deployments with per-agent origins or service
 * authentication pass an explicit `transport` instead.
 */
function defaultWorkspaceAgentTransport(name: string): WorkspaceAgentTransport {
  return {
    url: () => {
      const base = process.env[WORKSPACE_BASE_URL_ENV]?.trim();
      if (base === undefined || base.length === 0) {
        throw new Error(
          `No default workspace-agent transport is available: set ${WORKSPACE_BASE_URL_ENV} to the origin serving the workspace, or provide transport to defineWorkspaceAgent().`,
        );
      }
      return `${base.replace(/\/+$/, "")}${workspaceAgentRoutePrefix(name)}`;
    },
  };
}
