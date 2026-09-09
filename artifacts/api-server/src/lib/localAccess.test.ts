import assert from "node:assert/strict";
import test from "node:test";
import {
  FORWARDING_HEADERS,
  isLocalRequest,
  isLoopbackAddress,
  localAccessRefusal,
  type LocalAccessRequest,
} from "./localAccess";

const req = (peer: string | null | undefined, headers: Record<string, string | string[]> = {}): LocalAccessRequest =>
  ({ headers, socket: { remoteAddress: peer } }) as LocalAccessRequest;

test("loopback in every spelling Node reports is local", () => {
  for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "127.0.0.53", "::FFFF:127.0.0.1", " ::1 "]) {
    assert.equal(isLoopbackAddress(address), true, address);
  }
});

test("anything that is not this machine is not local", () => {
  for (const address of [
    "192.168.1.10",       // private LAN — a colleague on the same wifi
    "10.0.0.5",           // private LAN
    "172.17.0.1",         // docker bridge: the host as seen from a container
    "203.0.113.7",        // public
    "::ffff:192.168.1.10", // IPv4-mapped private
    "fe80::1",            // link-local
    "2001:db8::1",        // public IPv6
    "0.0.0.0",
    "",
  ]) {
    assert.equal(isLoopbackAddress(address), false, address);
  }
  assert.equal(isLoopbackAddress(undefined), false);
  assert.equal(isLoopbackAddress(null), false);
});

test("a request from this machine, unrelayed, is allowed", () => {
  assert.equal(localAccessRefusal(req("127.0.0.1")), null);
  assert.equal(localAccessRefusal(req("::1")), null);
  assert.equal(isLocalRequest(req("::ffff:127.0.0.1")), true);
});

test("a remote peer is refused whatever it claims in headers", () => {
  // The exact attack: a remote caller asserting it is local.
  const spoofed = req("203.0.113.7", {
    "x-forwarded-for": "127.0.0.1",
    "x-real-ip": "127.0.0.1",
    host: "localhost:5000",
    origin: "http://localhost:5173",
    referer: "http://localhost:5173/listen/abc",
  });
  assert.equal(isLocalRequest(spoofed), false);
  assert.match(localAccessRefusal(spoofed) ?? "", /203\.0\.113\.7 is not loopback/);
});

test("a loopback peer that relayed someone else's request is refused", () => {
  // A reverse proxy or tunnel on the same box: the peer is local, the caller is not.
  for (const header of FORWARDING_HEADERS) {
    const relayed = req("127.0.0.1", { [header]: "203.0.113.7" });
    assert.equal(isLocalRequest(relayed), false, header);
    assert.match(localAccessRefusal(relayed) ?? "", new RegExp(header));
  }
  // An empty forwarding header is not a relay.
  assert.equal(localAccessRefusal(req("127.0.0.1", { "x-forwarded-for": "  " })), null);
  assert.equal(localAccessRefusal(req("127.0.0.1", { "x-forwarded-for": [] })), null);
});

test("a request with no peer address at all is refused, not assumed local", () => {
  assert.equal(isLocalRequest(req(undefined)), false);
  assert.equal(isLocalRequest(req(null)), false);
  assert.equal(isLocalRequest({ headers: {} } as LocalAccessRequest), false);
  assert.match(localAccessRefusal(req(undefined)) ?? "", /no peer address/);
});
