/**
 * When a development sign-in may exist at all (PR-70).
 *
 * Kept apart from `routes/devAuth.ts` so the policy is a pure function of the
 * environment with no database, logger or Express in its import graph: the
 * rule that decides whether a credential-free session can be minted should be
 * readable, and testable, on its own.
 *
 * Both conditions are required, and both are deliberately strict:
 *   - `NODE_ENV !== "production"` — the surface cannot exist in production;
 *   - `DEV_AUTH_ENABLED === "true"` — the exact string, so a stray `1` or
 *     `yes` in an environment file does not open it.
 *
 * A third gate applies per request and lives in `localAccess.ts`: the caller
 * must be on this machine.
 */
/** The only paths the development sign-in router answers; the loopback gate is mounted on exactly these. */
export const DEV_AUTH_PATHS = ["/dev-login", "/dev-logout"] as const;

export function devAuthEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.DEV_AUTH_ENABLED === "true"
  );
}
