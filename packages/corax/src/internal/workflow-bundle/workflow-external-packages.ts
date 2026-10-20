// just-bash and microsandbox are optional peer dependencies (the
// opt-in local sandbox engines) loaded lazily from the application's
// install; just-bash additionally exposes native optional codecs for
// xz/zstd support. All of these must stay external so workflow step
// bundles neither fail resolving an absent optional install nor try to
// inline platform-specific `.node` artifacts.
export const WORKFLOW_STEP_EXTERNAL_PACKAGES = [
  "@mongodb-js/zstd",
  "just-bash",
  "microsandbox",
  "node-liblzma",
] as const;

/**
 * Packages that must stay external during the initial workflow builder
 * pass so `node:*` transitive dependencies do not fail the workflow VM check.
 * Nitro performs the final bundling/tracing pass for the host output.
 */
export const WORKFLOW_BUILDER_DEFERRED_PACKAGES = ["@chat-adapter/slack", "chat"] as const;