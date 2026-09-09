/**
 * Loopback gate for development-only surfaces (PR-70).
 *
 * `routes/devAuth.ts` mints a full owner session with no credentials. Its
 * existing gates are `NODE_ENV !== "production"` and `DEV_AUTH_ENABLED`, which
 * say *when* it may exist but not *who* may reach it: an operator who runs a
 * development build on a machine with an open port, or who tunnels the API,
 * hands a session to anyone who finds it. This module adds the missing half —
 * the request must come from the machine itself.
 *
 * **The peer address, never a header.** `req.ip` follows Express's `trust
 * proxy` setting and can therefore be an `X-Forwarded-For` value, which a
 * caller controls. `req.socket.remoteAddress` is the TCP peer, which it does
 * not. Everything here reads the socket, so no header can make a remote
 * request look local — that is the whole point of the file.
 *
 * A forwarding header on a request that *is* from loopback is read, not
 * ignored: every address it names must itself be loopback. That admits the
 * one legitimate local relay — the studio's Vite dev proxy on the same
 * machine forwarding a browser on the same machine — and still refuses a
 * tunnel or reverse proxy relaying a public caller, because that hop writes
 * the caller's public address into the header. An unparsable or empty-valued
 * forwarding header is refused: an address we cannot read is not local.
 */
import type { NextFunction, Request, Response } from "express";

/** The addresses that mean "this machine". IPv6 loopback, IPv4 loopback, and IPv4-mapped IPv6. */
export const LOOPBACK_ADDRESSES: readonly string[] = ["::1", "127.0.0.1", "::ffff:127.0.0.1"];

/**
 * Headers in which a relay names the caller's address. Every address they
 * name must be loopback. `x-forwarded-host` is deliberately absent: it names
 * the host the client asked for, not the client, so it says nothing about
 * where the caller is.
 */
export const FORWARDING_HEADERS: readonly string[] = [
  "x-forwarded-for",
  "x-real-ip",
  "forwarded",
  "cf-connecting-ip",
  "true-client-ip",
];

const normalise = (address: string): string => {
  const trimmed = address.trim().toLowerCase();
  // Node reports IPv6 scope ids on link-local addresses; loopback has none, but strip defensively.
  const withoutScope = trimmed.split("%")[0];
  if (withoutScope.startsWith("::ffff:")) {
    const mapped = withoutScope.slice("::ffff:".length);
    return /^127\./.test(mapped) ? "127.0.0.1" : mapped;
  }
  return /^127\./.test(withoutScope) ? "127.0.0.1" : withoutScope;
};

/** True when `address` is a loopback address of this machine. */
export function isLoopbackAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  return LOOPBACK_ADDRESSES.includes(normalise(address));
}

export type LocalAccessRequest = Pick<Request, "headers"> & {
  socket?: { remoteAddress?: string | null };
};

/**
 * Why this request may not use a localhost-only surface, or null when it may.
 * The reason is for the server's own log; the route returns a flat 404/503 so
 * that a remote caller learns nothing about what exists.
 */
export function localAccessRefusal(req: LocalAccessRequest): string | null {
  const peer = req.socket?.remoteAddress ?? null;
  if (!peer) return "the request has no peer address";
  if (!isLoopbackAddress(peer)) return `peer ${peer} is not loopback`;
  for (const header of FORWARDING_HEADERS) {
    const raw = req.headers?.[header];
    const values = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw])
      .flatMap((v) => String(v).split(","))
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    if (!values.length) continue;
    const relayedFrom = values.map(forwardedAddress).find((address) => !isLoopbackAddress(address));
    if (relayedFrom !== undefined) {
      return `request carries ${header} naming ${relayedFrom || "an unreadable address"}: a relay brought in a caller that is not this machine`;
    }
  }
  return null;
}

/**
 * The address inside one forwarding-header element. `Forwarded` (RFC 7239)
 * carries `for=203.0.113.7` / `for="[::1]:5173"`; the X- headers carry a bare
 * address, sometimes with a port. Anything else comes back as "" and is
 * refused by the caller.
 */
function forwardedAddress(element: string): string {
  let value = element;
  const forParam = /(?:^|;)\s*for=([^;]+)/i.exec(element);
  if (forParam) value = forParam[1].trim();
  value = value.replace(/^"|"$/g, "");
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end > 0 ? value.slice(1, end) : "";
  }
  // IPv4 with a port, or a bare IPv6/IPv4 address.
  const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value);
  if (ipv4WithPort) return ipv4WithPort[1];
  return /^[0-9a-f.:]+$/i.test(value) ? value : "";
}

/** True when this request came from the machine itself, unrelayed. */
export const isLocalRequest = (req: LocalAccessRequest): boolean => localAccessRefusal(req) === null;

/**
 * Express middleware form: refuse anything that is not an unrelayed loopback
 * request with a flat 404, so a remote caller learns nothing about what is
 * mounted behind it. `onRefusal` receives the reason for the server's own log;
 * the logger is injected rather than imported so this module stays free of the
 * transport machinery and can be tested on its own.
 */
export function requireLocalRequest(
  onRefusal?: (reason: string, path: string) => void,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const refusal = localAccessRefusal(req);
    if (refusal) {
      onRefusal?.(refusal, req.path);
      res.status(404).json({ error: "Not found" });
      return;
    }
    next();
  };
}
