const GHCR_CORAX_SANDBOX_IMAGE_REPOSITORY = "ghcr.io/vercel/eve";
// Upstream manifest verified independently of Corax's release version.
const UPSTREAM_SANDBOX_IMAGE_TAG = "0.79.1";

export function resolveCoraxSandboxImage(): string {
  return `${GHCR_CORAX_SANDBOX_IMAGE_REPOSITORY}:${resolveCoraxSandboxImageTag()}`;
}

function resolveCoraxSandboxImageTag(): string {
  const override = process.env.CORAX_SANDBOX_IMAGE_TAG?.trim();
  return override !== undefined && override.length > 0
    ? override
    : UPSTREAM_SANDBOX_IMAGE_TAG;
}

export const DEFAULT_CORAX_SANDBOX_IMAGE = resolveCoraxSandboxImage();
