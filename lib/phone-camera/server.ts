import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { videoRequestOrigin, VideoError } from "@/lib/live-mirror/video-server";
import { z } from "zod";
import { getDatabase } from "@/lib/db/client";
import { isTryOnTesting } from "@/lib/try-on-policy";

export const lifetime = 10 * 60_000;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("hex");
let ready: Promise<unknown> | undefined;
export async function database() {
  ready ??= getDatabase().batch([
    `CREATE TABLE IF NOT EXISTS camera_pair (
      id TEXT PRIMARY KEY, host TEXT NOT NULL, phone TEXT NOT NULL, claimant TEXT,
      expires INTEGER NOT NULL, offer TEXT, answer TEXT, closed INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS camera_pair_candidates (
      pair_id TEXT NOT NULL, role TEXT NOT NULL, candidates TEXT NOT NULL,
      PRIMARY KEY (pair_id, role)
    )`,
  ], "write").catch(error => { ready = undefined; throw error; });
  await ready;
  await getDatabase().execute({ sql: "DELETE FROM camera_pair WHERE expires < ?", args: [Date.now()] });
  await getDatabase().execute("DELETE FROM camera_pair_candidates WHERE pair_id NOT IN (SELECT id FROM camera_pair)");
  return getDatabase();
}
export async function createPair() {
  const db = await database();
  const id = token(), host = token(), phone = token(), expires = Date.now() + lifetime;
  await db.execute({ sql: "INSERT INTO camera_pair (id, host, phone, expires) VALUES (?, ?, ?, ?)", args: [id, hash(host), hash(phone), expires] });
  return { id, host, phone, expires, unlimitedSession: isTryOnTesting() };
}
export class PairError extends Error { constructor(public status: number, message: string) { super(message); } }
export function sameOrigin(request: Request) {
  videoRequestOrigin(request);
}
export async function readBody(request: Request) {
  sameOrigin(request);
  const reader = request.body?.getReader();
  if (!reader) throw new PairError(400, "Missing connection data.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 48_000) { await reader.cancel(); throw new PairError(413, "Connection data is too large."); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function authenticate(request: Request, id: string) {
  const credential = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!/^[a-f0-9]{64}$/.test(id) || !/^[a-f0-9]{64}$/.test(credential)) throw new PairError(401, "Scan a new QR code from your computer.");
  const db = await database();
  const row = (await db.execute({ sql: "SELECT * FROM camera_pair WHERE id = ? AND expires > ?", args: [id, Date.now()] })).rows[0];
  if (!row || row.closed) throw new PairError(410, "This connection ended or expired. Scan a new QR code.");
  const digest = hash(credential);
  const role = digest === row.host ? "host" : digest === row.phone ? "phone" : null;
  if (!role) throw new PairError(401, "This connection link is invalid.");
  return { db, row, role, id };
}
export const reply = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
export function failure(error: unknown) {
  if (error instanceof VideoError) return reply({ error: error.message }, error.status);
  if (error instanceof z.ZodError || error instanceof SyntaxError) return reply({ error: "Invalid connection request." }, 400);
  return reply({ error: error instanceof PairError ? error.message : "The phone connection is unavailable. Please try again." }, error instanceof PairError ? error.status : 503);
}
export async function iceConfiguration() {
  const direct = { iceServers: [{ urls: "stun:stun.relay.metered.ca:80" }] as RTCIceServer[], relayAvailable: false, relayProvider: null };
  const app = process.env.METERED_TURN_APP?.trim(), key = process.env.METERED_TURN_API_KEY?.trim();
  if (!app && !key) return { ...direct, relayStatus: "unconfigured" as const };
  // A relay outage must not prevent two devices on a reachable network from pairing.
  if (!app || !key || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(app)) return { ...direct, relayStatus: "unavailable" as const };
  try {
    const response = await fetch(`https://${app}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!response.ok) throw new Error("Relay credentials unavailable.");
    const url = z.string().max(2048).regex(/^(?:stun|turn|turns):[^\s]+$/);
    const parsed = z.array(z.object({
      urls: z.union([url, z.array(url).min(1).max(8)]),
      username: z.string().max(2048).optional(), credential: z.string().max(2048).optional(),
    })).min(1).max(20).safeParse(await response.json());
    if (!parsed.success) throw new Error("Invalid relay credentials.");
    const relays = parsed.data.filter(server => [server.urls].flat().some(value => /^turns?:/.test(value)));
    if (!relays.length || relays.some(server => !server.username || !server.credential)) throw new Error("Invalid relay credentials.");
    return { iceServers: parsed.data, relayAvailable: true, relayProvider: "metered" as const, relayStatus: "ready" as const };
  } catch {
    // Never include the credential URL, provider response, or API key in diagnostics.
    return { ...direct, relayStatus: "unavailable" as const };
  }
}
