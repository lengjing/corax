import { resolveInstalledPackageInfo } from "#internal/application/package.js";
import { stripVersionBuildMetadata } from "#shared/package-version.js";

const GHCR_CORAX_SANDBOX_IMAGE_REPOSITORY = "ghcr.io/vercel/eve";

export function resolveCoraxSandboxImage(): string {
  return `${GHCR_CORAX_SANDBOX_IMAGE_REPOSITORY}:${resolveCoraxSandboxImageTag()}`;
}

function resolveCoraxSandboxImageTag(): string {
  const override = process.env.CORAX_SANDBOX_IMAGE_TAG?.trim();
  return override !== undefined && override.length > 0
    ? override
    : stripVersionBuildMetadata(resolveInstalledPackageInfo().version);
}

export const DEFAULT_CORAX_SANDBOX_IMAGE = resolveCoraxSandboxImage();