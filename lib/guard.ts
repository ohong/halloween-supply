// Bounded concurrency plus a kill switch for one provider-backed code path.
// Limits are per server instance (in memory); global rate limits live in the Vercel Firewall.
// Kill switch: PROVIDERS_DISABLED="name1,name2" or "all", read on every call. Disabled guards refuse
// immediately, and the caller must answer 503 { error: "temporarily_unavailable" }.

export const UNAVAILABLE = "temporarily_unavailable";
export type Release = () => void;

export function guardProvider(name: string, { maxActive }: { maxActive: number }) {
  let active = 0;
  return {
    /** Takes a slot. Returns its idempotent release function, or the reason it refused. */
    acquire(): Release | "busy" | "disabled" {
      const off = (process.env.PROVIDERS_DISABLED ?? "").split(",").map(item => item.trim());
      if (off.includes("all") || off.includes(name)) return "disabled";
      if (active >= maxActive) return "busy";
      active++;
      let released = false;
      return () => { if (!released) { released = true; active--; } };
    },
  };
}
