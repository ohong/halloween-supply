import { handoffId, putHandoff, takeHandoff } from "@/lib/photo/handoff";

// The phone posts the prepared JPEG; the desktop polls until it arrives.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!handoffId.test(id)) return Response.json({ error: "This link is not valid." }, { status: 400 });
  if (request.headers.get("content-type") !== "image/jpeg") return Response.json({ error: "Send a JPEG photo." }, { status: 415 });
  const photo = new Uint8Array(await request.arrayBuffer());
  if (photo.length === 0 || photo.length > 3 * 1024 * 1024) return Response.json({ error: "This photo is too large. Try another one." }, { status: 413 });
  await putHandoff(id, photo);
  return Response.json({ ok: true });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!handoffId.test(id)) return Response.json({ error: "This link is not valid." }, { status: 400 });
  const photo = await takeHandoff(id);
  if (!photo) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  return new Response(photo, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
}
