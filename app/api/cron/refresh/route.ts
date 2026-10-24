import { refreshAllProducts } from "@/lib/checkout/refresh";

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ status: "error", message: "Unauthorized" }, { status: 401 });
  }
  try {
    const summary = await refreshAllProducts();
    return Response.json({ status: "ok", ...summary });
  } catch (e) {
    console.error("[cron/refresh] failed", e);
    return Response.json({ status: "error", message: e instanceof Error ? e.message : "refresh failed" }, { status: 500 });
  }
}
