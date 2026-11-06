/**
 * The published npm package name for the corax framework.
 *
 * This module is intentionally free of side effects and heavy imports so that
 * any layer can reference the package identity without pulling in filesystem
 * or module-resolution code.
 */
export const CORAX_PACKAGE_NAME = "@coraxjs/core";
export const CORAX_PRODUCT_NAME = "corax";
/** Stable persisted Workflow identity; independent of the npm package name. */
export const CORAX_WORKFLOW_NAMESPACE = "corax";

/** Recognize the canonical package and the historical npm alias in authored code. */
export function isCoraxPackageImport(specifier: string): boolean {
  return specifier === CORAX_PACKAGE_NAME || specifier.startsWith(`${CORAX_PACKAGE_NAME}/`)
    || specifier === "corax" || specifier.startsWith("corax/");
}

/** Resolve internal self-imports through the canonical package installation. */
export function canonicalCoraxImport(specifier: string): string {
  return specifier === "corax" || specifier.startsWith("corax/")
    ? `${CORAX_PACKAGE_NAME}${specifier.slice("corax".length)}`
    : specifier;
}
