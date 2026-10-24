/** Map with a concurrency limit. Never rejects: each slot is {ok, value|error}. */
export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

export async function mapLimit<I, O>(items: readonly I[], limit: number, fn: (item: I, index: number) => Promise<O>): Promise<Settled<O>[]> {
  const out: Settled<O>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = { ok: true, value: await fn(items[i], i) };
      } catch (error) {
        out[i] = { ok: false, error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
