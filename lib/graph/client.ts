import { FalkorDB } from "falkordb";
import type { Graph } from "falkordb";

// One FalkorDB connection per server instance. The promise is cached at module
// level and reset on any error so the next call reconnects.

export const GRAPH_NAME = "halloween";
const CONNECT_TIMEOUT_MS = 3000;

type Connection = { db: FalkorDB; graph: Graph };

let cached: Promise<Connection> | null = null;

export function isGraphConfigured(): boolean {
  return Boolean(process.env.FALKORDB_URL);
}

async function connect(): Promise<Connection> {
  const url = process.env.FALKORDB_URL;
  if (!url) throw new Error("FALKORDB_URL is not set");
  const db = await FalkorDB.connect({
    url,
    socket: {
      connectTimeout: CONNECT_TIMEOUT_MS,
      // Fail fast instead of retrying forever; callers fall back to the snapshot.
      reconnectStrategy: (retries: number) => (retries >= 2 ? new Error("FalkorDB unreachable") : 150),
    },
  });
  // A late socket error must not crash the process; the next query surfaces it
  // and resetGraph() drops the connection.
  (db as unknown as { on?: (e: string, f: () => void) => void }).on?.("error", () => {
    cached = null;
  });
  return { db, graph: db.selectGraph(GRAPH_NAME) };
}

/** The cached graph handle. Rejects quickly when FalkorDB is unset or unreachable. */
export function getGraph(): Promise<Graph> {
  if (!cached) {
    const attempt = connect();
    cached = attempt;
    attempt.catch(() => {
      if (cached === attempt) cached = null;
    });
  }
  return cached.then((c) => c.graph);
}

/** Drop the cached connection (after an error, or at the end of a script). */
export async function resetGraph(): Promise<void> {
  const current = cached;
  cached = null;
  if (!current) return;
  try {
    const { db } = await current;
    await db.close();
  } catch {
    // already gone
  }
}
