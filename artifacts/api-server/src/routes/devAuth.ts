/**
 * Development-only sign-in.
 *
 * Production auth is Replit OIDC (`routes/auth.ts`). That flow needs a real
 * Replit issuer + `REPL_ID`, which do not exist in a local checkout. This
 * router mints a session for a fixed local user so the studio is usable end to
 * end during development.
 *
 * Hard gates (all required):
 *   - `NODE_ENV !== "production"`
 *   - `DEV_AUTH_ENABLED === "true"`
 *   - the request comes from **loopback, unrelayed** (PR-70)
 *
 * The router is not even mounted unless the first two hold, so there is no
 * production code path into it. The third is checked per request, because
 * mounting says *when* this exists and not *who* may reach it: a development
 * build on an open port, or a tunnel pointed at the API, would otherwise hand
 * a full owner session to anyone who found it. The peer address comes from the
 * socket, never from a header, so no `X-Forwarded-For` can forge it — see
 * `lib/localAccess.ts`.
 *
 * A refused request gets a flat 404: a remote caller should not learn that a
 * development sign-in exists here at all.
 */
import { db, usersTable } from "@workspace/db";
import { Router, type IRouter, type Request, type Response } from "express";

import { requireLocalRequest } from "../lib/localAccess";
import { logger } from "../lib/logger";

import {
  createSession,
  getSessionId,
  deleteSession,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth";

// The policy lives in lib/devAuthPolicy.ts so it can be read and tested without
// this module's database, logger and Express imports. Re-exported so existing
// callers (routes/index.ts, routes/auth.ts) keep importing it from here.
export { devAuthEnabled } from "../lib/devAuthPolicy";

const DEV_USER = {
  id: process.env.DEV_AUTH_USER_ID ?? "dev-local-user",
  email: process.env.DEV_AUTH_USER_EMAIL ?? "dev@localhost",
  firstName: "Local",
  lastName: "Developer",
  profileImageUrl: null as string | null,
};

const router: IRouter = Router();

/**
 * Every route below mints or destroys a session with no credentials, so every
 * route below is loopback-only. Applied as router-level middleware rather than
 * per handler: a route added later inherits the gate instead of forgetting it.
 * The gate itself lives in `lib/localAccess.ts`; the logger is passed in.
 */
router.use(
  requireLocalRequest((refusal, path) =>
    logger.warn({ refusal, path }, "dev_auth_refused_non_local_request"),
  ),
);

/**
 * Extra local identities (PR-34): a blind listening session needs raters who
 * are not the owner. Only with `DEV_AUTH_ALLOW_IDENTITIES=true`, on top of the
 * hard gates above, may a caller name the local user it signs in as; ids are
 * prefixed so they can never collide with a real account.
 */
function requestedIdentity(body: unknown): typeof DEV_USER | null {
  if (process.env.DEV_AUTH_ALLOW_IDENTITIES !== "true" || !body || typeof body !== "object") return null;
  const { userId, email, firstName } = body as { userId?: unknown; email?: unknown; firstName?: unknown };
  if (typeof userId !== "string" || !/^[a-z0-9][a-z0-9-]{0,40}$/i.test(userId)) return null;
  return {
    id: `dev-identity-${userId}`,
    email: typeof email === "string" && email.includes("@") ? email : `${userId}@localhost`,
    firstName: typeof firstName === "string" && firstName ? firstName : userId,
    lastName: "Local",
    profileImageUrl: null,
  };
}

async function startDevSession(res: Response, identity: typeof DEV_USER = DEV_USER): Promise<SessionData["user"]> {
  const [user] = await db
    .insert(usersTable)
    .values(identity)
    .onConflictDoUpdate({
      target: usersTable.id,
      set: { email: identity.email, updatedAt: new Date() },
    })
    .returning();

  const sessionUser: SessionData["user"] = {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    profileImageUrl: user.profileImageUrl,
  };

  const sid = await createSession({
    user: sessionUser,
    access_token: "dev-local-access-token",
    expires_at: Math.floor((Date.now() + SESSION_TTL) / 1000),
  });

  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    // Local dev is served over plain http; a Secure cookie would be dropped.
    secure: false,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });

  return sessionUser;
}

function getSafeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

// Browser convenience: visit the URL directly, land back in the app signed in.
router.get("/dev-login", async (req: Request, res: Response) => {
  await startDevSession(res);
  res.redirect(getSafeReturnTo(req.query.returnTo));
});

// Programmatic sign-in for scripts/tests.
router.post("/dev-login", async (req: Request, res: Response) => {
  const user = await startDevSession(res, requestedIdentity(req.body) ?? DEV_USER);
  res.json({ user });
});

router.post("/dev-logout", async (req: Request, res: Response) => {
  const sid = getSessionId(req);
  if (sid) await deleteSession(sid);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ success: true });
});

export default router;
