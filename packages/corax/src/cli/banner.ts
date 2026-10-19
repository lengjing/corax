import pc from "#compiled/picocolors/index.js";

import { resolveInstalledPackageInfo } from "#internal/application/package.js";

export const CORAX_WORDMARK = "corax";

/**
 * The boot banner shared by every CLI command that announces itself: the corax
 * badge plus the installed version.
 */
export function coraxCliBanner(): string {
  const { version } = resolveInstalledPackageInfo();
  return `${pc.bgBlack(pc.white(`☰${CORAX_WORDMARK}`))} ${pc.dim(`v${version}`)}`;
}

/**
 * The unstyled wordmark-and-version tag (`☰corax v0.24.5`) — the boot banner's
 * plain-text form. The dev TUI dims it as its parting line on teardown.
 */
export function coraxVersionTag(): string {
  const { version } = resolveInstalledPackageInfo();
  return `☰${CORAX_WORDMARK} v${version}`;
}
