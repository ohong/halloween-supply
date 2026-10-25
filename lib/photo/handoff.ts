import { getDatabase } from "../db/client";

// A phone hands one photo to a desktop through this table. Rows are deleted on
// pickup, and anything older than ten minutes is purged on every request.
export const handoffId = /^[0-9a-f-]{36}$/;
const ttlMs = 10 * 60 * 1000;
let ready: Promise<unknown> | undefined;

async function table() {
  ready ??= getDatabase().execute("CREATE TABLE IF NOT EXISTS photo_handoff (id TEXT PRIMARY KEY, photo BLOB NOT NULL, created_at INTEGER NOT NULL)");
  await ready;
  await getDatabase().execute({ sql: "DELETE FROM photo_handoff WHERE created_at < ?", args: [Date.now() - ttlMs] });
}

export async function putHandoff(id: string, photo: Uint8Array) {
  await table();
  await getDatabase().execute({ sql: "INSERT OR REPLACE INTO photo_handoff (id, photo, created_at) VALUES (?, ?, ?)", args: [id, photo, Date.now()] });
}

export async function takeHandoff(id: string): Promise<ArrayBuffer | null> {
  await table();
  const result = await getDatabase().execute({ sql: "DELETE FROM photo_handoff WHERE id = ? RETURNING photo", args: [id] });
  const photo = result.rows[0]?.photo;
  return photo instanceof ArrayBuffer ? photo : null;
}
