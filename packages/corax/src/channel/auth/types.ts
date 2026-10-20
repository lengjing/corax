import type {
  RuntimeSessionAuthAttributes,
  RuntimeSessionAuthContext,
  RuntimeSessionAuthenticator,
  RuntimeSessionPrincipalType,
} from "#shared/session-auth.js";

/**
 * Shared serializable token-claim projection used by auth verifiers.
 */
export type RouteAuthAttributes = RuntimeSessionAuthAttributes;

/**
 * One authenticated caller normalized into corax-owned runtime metadata.
 */
export interface AuthenticatedCallerPrincipal {
  readonly attributes: RouteAuthAttributes;
  readonly authenticator: RuntimeSessionAuthenticator;
  readonly claims: RouteAuthAttributes;
  readonly issuer?: string;
  readonly principalId: string;
  readonly principalType: RuntimeSessionPrincipalType;
  readonly subject?: string;
}

/**
 * Shared resolved token claim matchers.
 */
export interface ResolvedTokenClaimMatchers {
  readonly claims?: Readonly<Record<string, readonly string[]>>;
  readonly subjects?: readonly string[];
}

/**
 * Resolved HTTP Basic auth strategy.
 */
export interface ResolvedHttpBasicAuthStrategy {
  readonly kind: "http-basic";
  readonly password: string;
  readonly username: string;
}

/**
 * Resolved HMAC JWT auth strategy.
 */
export interface ResolvedJwtHmacAuthStrategy extends ResolvedTokenClaimMatchers {
  readonly algorithm: "HS256" | "HS384" | "HS512";
  readonly audiences: readonly string[];
  readonly clockSkewSeconds: number;
  readonly issuer: string;
  readonly kind: "jwt-hmac";
  readonly secret: string;
}

/**
 * Resolved ECDSA JWT auth strategy.
 */
export interface ResolvedJwtEcdsaAuthStrategy extends ResolvedTokenClaimMatchers {
  readonly algorithm: "ES256" | "ES384" | "ES512";
  readonly audiences: readonly string[];
  readonly clockSkewSeconds: number;
  readonly issuer: string;
  readonly kind: "jwt-ecdsa";
  readonly publicKey: string;
}

/**
 * Resolved OIDC auth strategy.
 */
export interface ResolvedOidcAuthStrategy extends ResolvedTokenClaimMatchers {
  readonly audiences: readonly string[];
  readonly clockSkewSeconds: number;
  readonly discoveryUrl: string;
  readonly issuer: string;
  readonly kind: "oidc";
}

/**
 * Internal strategy verification outcomes used by the route-auth orchestrator.
 */
export type RouteStrategyAuthenticationResult =
  | {
      readonly kind: "authenticated";
      readonly principal: AuthenticatedCallerPrincipal;
    }
  | {
      readonly kind: "caller-not-allowed";
    }
  | {
      readonly kind: "misconfigured";
      readonly message: string;
    }
  | {
      readonly kind: "not-authenticated";
    };

/**
 * Creates the session-auth projection persisted on runtime state and exposed to
 * authored code via `ctx.session.auth`.
 */
export function createRuntimeSessionAuthContext(
  principal: AuthenticatedCallerPrincipal,
): RuntimeSessionAuthContext {
  return {
    attributes: principal.attributes,
    authenticator: principal.authenticator,
    issuer: principal.issuer,
    principalId: principal.principalId,
    principalType: principal.principalType,
    subject: principal.subject,
  };
}
