// Old one-photo links cannot be reused by the continuous camera flow.
export function GET() { return Response.json({ error: "This photo link expired. Open a new phone camera connection on your computer." }, { status: 410, headers: { "Cache-Control": "no-store" } }); }
export const POST = GET;
