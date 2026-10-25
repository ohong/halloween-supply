import { z } from "zod";
import { isTryOnTesting } from "@/lib/try-on-policy";
import { authenticate, failure, iceServers, PairError, readBody, reply, sameOrigin } from "@/lib/phone-camera/server";
type Context = { params: Promise<{ id: string }> };
const signal = z.object({ type: z.enum(["offer", "answer"]), sdp: z.string().min(1).max(40_000) });
const candidate = z.object({ candidate: z.string().max(2000), sdpMid: z.string().max(100).nullable().optional(), sdpMLineIndex: z.number().int().min(0).max(100).nullable().optional(), usernameFragment: z.string().max(256).nullable().optional() }).strict();
const update = z.discriminatedUnion("action", [
  z.object({ action: z.literal("candidates"), candidates: z.array(candidate).max(128), claimant: z.string().uuid().optional() }).strict(),
  z.object({ action: z.literal("claim"), claimant: z.string().uuid() }).strict(),
  z.object({ action: z.literal("signal"), description: signal, claimant: z.string().uuid().optional() }).strict(),
]);
export async function GET(request: Request, context: Context) {
  try {
    const { db, row, role, id } = await authenticate(request, (await context.params).id);
    const remote = (await db.execute({ sql: "SELECT candidates FROM camera_pair_candidates WHERE pair_id = ? AND role = ?", args: [id, role === "host" ? "phone" : "host"] })).rows[0];
    return reply({ candidates: remote ? JSON.parse(String(remote.candidates)) : [], expires: row.expires, description: row[role === "host" ? "offer" : "answer"] ? JSON.parse(String(row[role === "host" ? "offer" : "answer"])) : null });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const body = update.parse(await readBody(request));
    const { db, row, role, id } = await authenticate(request, (await context.params).id);
    if (body.action === "claim") {
      if (role === "phone") {
        const claimed = await db.execute({ sql: "UPDATE camera_pair SET claimant = ? WHERE id = ? AND (claimant IS NULL OR claimant = ?) RETURNING id", args: [body.claimant, id, body.claimant] });
        if (!claimed.rows.length) throw new PairError(409, "Another phone is already using this link. Create a new connection on your computer.");
      }
      return reply({ iceServers: await iceServers(), expires: row.expires, unlimitedSession: isTryOnTesting() });
    }
    if (role === "phone" && body.claimant !== row.claimant) throw new PairError(403, "This phone has not joined the connection.");
    if (body.action === "candidates") {
      await db.execute({ sql: "INSERT INTO camera_pair_candidates (pair_id, role, candidates) VALUES (?, ?, ?) ON CONFLICT(pair_id, role) DO UPDATE SET candidates = excluded.candidates", args: [id, role, JSON.stringify(body.candidates)] });
      return reply({ ok: true });
    }
    if (body.description.type !== (role === "phone" ? "offer" : "answer")) throw new PairError(403, "Invalid connection step.");
    const column = role === "phone" ? "offer" : "answer";
    const result = await db.execute({ sql: `UPDATE camera_pair SET ${column} = ? WHERE id = ? AND ${column} IS NULL RETURNING id`, args: [JSON.stringify(body.description), id] });
    if (!result.rows.length) throw new PairError(409, "This link has already been used. Scan a new QR code.");
    return reply({ ok: true });
  } catch (error) { return failure(error); }
}
export async function DELETE(request: Request, context: Context) {
  try {
    sameOrigin(request);
    const { db, id } = await authenticate(request, (await context.params).id);
    await db.batch([
      { sql: "DELETE FROM camera_pair_candidates WHERE pair_id = ?", args: [id] },
      { sql: "DELETE FROM camera_pair WHERE id = ?", args: [id] },
    ], "write");
    return reply({ ok: true });
  } catch (error) { return failure(error); }
}
