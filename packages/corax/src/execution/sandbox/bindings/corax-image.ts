import { resolveInstalledPackageInfo } from "#internal/application/package.js";
import { stripVersionBuildMetadata } from "#shared/package-version.js";

const GHCR_CORAX_SANDBOX_IMAGE_REPOSITORY = "ghcr.io/vercel/eve";
const VERCEL_CORAX_SANDBOX_IMAGE_REPOSITORY = "vcr.vercel.com/vercel/eve/base";

export function resolveCoraxSandboxImage(): string {
  return `${GHCR_CORAX_SANDBOX_IMAGE_REPOSITORY}:${resolveCoraxSandboxImageTag()}`;
}

export function resolveVercelCoraxSandboxImage(): string {
  return `${VERCEL_CORAX_SANDBOX_IMAGE_REPOSITORY}:${resolveCoraxSandboxImageTag()}`;
}

function resolveCoraxSandboxImageTag(): string {
  const override = process.env.CORAX_SANDBOX_IMAGE_TAG?.trim();
  return override !== undefined && override.length > 0
    ? override
    : stripVersionBuildMetadata(resolveInstalledPackageInfo().version);
}

export const DEFAULT_CORAX_SANDBOX_IMAGE = resolveCoraxSandboxImage();
export const VERCEL_CORAX_SANDBOX_IMAGE = resolveVercelCoraxSandboxImage();
