import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { refreshAllProducts } from "@/lib/checkout/refresh";

export const maxDuration = 300;

const headers = { "Cache-Control": "no-store" };

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization) return false;
  const supplied = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ status: "error", message: "Unauthorized" }, { status: 401, headers });
  }
  const startedAt = Date.now();
  try {
    const summary = await refreshAllProducts();
    if (summary.graphWritten > 0) revalidateTag("catalog", { expire: 0 });
    const failed = Boolean(summary.graphError) || summary.checked === 0 || summary.verified === 0;
    const partial = !failed && summary.unverified.length > 0;
    return Response.json(
      {
        status: failed ? "error" : partial ? "partial" : "ok",
        ...summary,
        durationMs: Date.now() - startedAt,
      },
      { status: failed ? 503 : partial ? 207 : 200, headers },
    );
  } catch {
    // Provider errors can include request URLs or credentials; keep responses and logs generic.
    console.error("[cron/refresh] refresh failed");
    return Response.json({ status: "error", message: "Catalog refresh failed" }, { status: 503, headers });
  }
}
