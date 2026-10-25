/** Queue time counts against the caller's deadline; cancelled jobs never start. */
export function workQueue(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const start = () => { signal?.removeEventListener("abort", abort); active++; resolve(); };
      const abort = () => {
        const index = waiting.indexOf(start);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal?.reason);
      };
      if (active < limit) start();
      else { waiting.push(start); signal?.addEventListener("abort", abort, { once: true }); }
    });
    try { signal?.throwIfAborted(); return await task(); }
    finally { active--; waiting.shift()?.(); }
  };
}
