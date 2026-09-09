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
 * The router is not even mounted unless both hold, so there is no production
 * code path into it.
 */
import { db, usersTable } from "@workspace/db";
import { Router, type IRouter, type Request, type Response } from "express";

import {
  createSession,
  getSessionId,
  deleteSession,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth";

export function devAuthEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.DEV_AUTH_ENABLED === "true"
  );
}

const DEV_USER = {
  id: process.env.DEV_AUTH_USER_ID ?? "dev-local-user",
  email: process.env.DEV_AUTH_USER_EMAIL ?? "dev@localhost",
  firstName: "Local",
  lastName: "Developer",
  profileImageUrl: null as string | null,
};

const router: IRouter = Router();

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
