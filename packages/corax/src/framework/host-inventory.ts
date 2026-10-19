import {
  CORAX_DEV_DISPATCH_SCHEDULE_ROUTE_PATTERN,
  CORAX_DEV_RUNTIME_ARTIFACTS_REBUILD_ROUTE_PATH,
  CORAX_DEV_RUNTIME_ARTIFACTS_RESUME_ROUTE_PATH,
  CORAX_DEV_RUNTIME_ARTIFACTS_ROUTE_PATH,
  CORAX_DEV_RUNTIME_ARTIFACTS_SUSPEND_ROUTE_PATH,
  CORAX_PRODUCTION_CRON_ROUTE_PATTERN,
} from "#protocol/routes.js";
import { CORAX_WORKFLOW_FLOW_ROUTE_PATH } from "#internal/workflow-bundle/corax-service-route-output.js";
import {
  DEVELOPMENT_WORKFLOW_STREAM_ROUTE,
  DEVELOPMENT_WORKFLOW_WORLD_ROUTE,
} from "#internal/workflow/development-world-protocol.js";

type HostHttpMethod = "ALL" | "GET" | "POST";

interface HostHttpRegistration {
  readonly capability: "workflow" | "development" | "schedule";
  readonly method: HostHttpMethod;
  readonly path: string;
  readonly reservationOnly?: boolean;
}

export const HOST_HTTP_INVENTORY: readonly HostHttpRegistration[] = Object.freeze([
  { capability: "workflow", method: "ALL", path: CORAX_WORKFLOW_FLOW_ROUTE_PATH },
  { capability: "development", method: "GET", path: CORAX_DEV_RUNTIME_ARTIFACTS_ROUTE_PATH },
  {
    capability: "development",
    method: "GET",
    path: CORAX_DEV_RUNTIME_ARTIFACTS_REBUILD_ROUTE_PATH,
  },
  {
    capability: "development",
    method: "POST",
    path: CORAX_DEV_RUNTIME_ARTIFACTS_REBUILD_ROUTE_PATH,
  },
  {
    capability: "development",
    method: "POST",
    path: CORAX_DEV_RUNTIME_ARTIFACTS_SUSPEND_ROUTE_PATH,
  },
  {
    capability: "development",
    method: "POST",
    path: CORAX_DEV_RUNTIME_ARTIFACTS_RESUME_ROUTE_PATH,
  },
  { capability: "development", method: "ALL", path: DEVELOPMENT_WORKFLOW_WORLD_ROUTE },
  { capability: "development", method: "ALL", path: DEVELOPMENT_WORKFLOW_STREAM_ROUTE },
  { capability: "schedule", method: "POST", path: CORAX_DEV_DISPATCH_SCHEDULE_ROUTE_PATTERN },
  {
    capability: "schedule",
    method: "ALL",
    path: CORAX_PRODUCTION_CRON_ROUTE_PATTERN,
    reservationOnly: true,
  },
]);
