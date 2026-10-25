import "server-only";

import { randomUUID } from "node:crypto";
import { getDatabase } from "../db/client";
import { validateCustomLook } from "./validate";
import type { CustomLook } from "./types";

const STALE_AFTER_MS = 4 * 60_000;
const staleMessage = "This creation stopped before it finished. Start a new attempt to try again.";
let schema: Promise<void> | undefined;

async function ensureSchema() {
  if (!schema) {
    schema = getDatabase().execute(`CREATE TABLE IF NOT EXISTS custom_looks (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL CHECK (json_valid(payload) AND json_extract(payload, '$.id') = id),
      updated_at INTEGER NOT NULL
    )`).then(() => undefined).catch((error) => { schema = undefined; throw error; });
  }
  return schema;
}

/** A stale lease becomes terminal; replaying an old request never repeats paid work. */
async function expireStale(id: string) {
  await getDatabase().execute({
    sql: `UPDATE custom_looks SET payload = json_set(payload, '$.state', 'failed', '$.error', ?), updated_at = ?
      WHERE id = ? AND json_extract(payload, '$.state') = 'running' AND updated_at < ?`,
    args: [staleMessage, Date.now(), id, Date.now() - STALE_AFTER_MS],
  });
}

export async function readCustomLook(id: string): Promise<CustomLook | null> {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return null;
  await ensureSchema();
  await expireStale(id);
  const result = await getDatabase().execute({ sql: "SELECT payload FROM custom_looks WHERE id = ?", args: [id] });
  return result.rows[0] ? validateCustomLook(JSON.parse(String(result.rows[0].payload))) : null;
}

export async function readCustomLookRequest(requestId: string): Promise<CustomLook | null> {
  await ensureSchema();
  const result = await getDatabase().execute({ sql: "SELECT id FROM custom_looks WHERE request_id = ?", args: [requestId] });
  return result.rows[0] ? readCustomLook(String(result.rows[0].id)) : null;
}

export async function claimCustomLook(input: { requestId: string; query: string; model: "male" | "female" }) {
  await ensureSchema();
  const look: CustomLook = {
    id: randomUUID(), query: input.query, model: input.model,
    name: input.query, summary: "", state: "running", pieces: [], createdAt: new Date().toISOString(),
  };
  const inserted = await getDatabase().execute({
    sql: "INSERT INTO custom_looks (id, request_id, payload, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(request_id) DO NOTHING RETURNING payload",
    args: [look.id, input.requestId, JSON.stringify(look), Date.now()],
  });
  if (inserted.rows.length) return { claimed: true, look };
  const saved = await readCustomLookRequest(input.requestId);
  if (!saved) throw new Error("The claimed custom look could not be read.");
  return { claimed: false, look: saved };
}

/** Only the live request can finish its row. Expired leases cannot overwrite a terminal result. */
export async function saveCustomLook(input: CustomLook): Promise<void> {
  const look = validateCustomLook(input);
  const result = await getDatabase().execute({
    sql: `UPDATE custom_looks SET payload = ?, updated_at = ?
      WHERE id = ? AND json_extract(payload, '$.state') = 'running' RETURNING id`,
    args: [JSON.stringify(look), Date.now(), look.id],
  });
  if (!result.rows.length) throw new Error("The custom look is no longer running.");
}
