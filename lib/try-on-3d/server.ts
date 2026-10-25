import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PreviewError } from "@/lib/ai/openai";
import type { RenderOffer, RenderProvider, RenderStatus } from "./types";

export const FAL_MODELS = {
  meshy: { endpoint: "meshy/v7.1/image-to-3d", queue: "https://queue.fal.run/meshy/v7.1/requests", label: "fal / Meshy 7.1" },
  hunyuan: { endpoint: "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d", queue: "https://queue.fal.run/fal-ai/hunyuan-3d/requests", label: "fal / Hunyuan 3D 3.1 Pro" },
  trellis: { endpoint: "fal-ai/trellis-2", queue: "https://queue.fal.run/fal-ai/trellis-2/requests", label: "fal / TRELLIS.2" },
} as const;
const providerSchema = z.enum(["trellis", "meshy", "hunyuan"]);
const previewSchema = z.object({ kind: z.literal("preview"), digest: z.string(), provider: providerSchema, expires: z.number() });
const jobSchema = z.object({ kind: z.literal("job"), id: z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/), provider: providerSchema, expires: z.number() });
export function configuredProvider(): RenderProvider | null {
  if (!process.env.FAL_KEY) return null;
  const choice = process.env.TRY_ON_3D_PROVIDER === "fal" ? "hunyuan" : process.env.TRY_ON_3D_PROVIDER;
  return providerSchema.catch("hunyuan").parse(choice);
}
function secret() {
  const value = process.env.TRY_ON_3D_SIGNING_SECRET || process.env.FAL_KEY;
  if (!value) throw new PreviewError(503, "3D previews are not available yet.");
  return value;
}
function sign(payload: object) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${createHmac("sha256", secret()).update(`try-on-3d:${data}`).digest("base64url")}`;
}
function verify(token: string): unknown {
  const [data, mac, extra] = token.split(".");
  if (!data || !mac || extra) throw new PreviewError(403, "This preview link is invalid. Create a new photo preview.");
  const expected = createHmac("sha256", secret()).update(`try-on-3d:${data}`).digest();
  const actual = Buffer.from(mac, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) throw new PreviewError(403, "This preview link is invalid. Create a new photo preview.");
  const payload = JSON.parse(Buffer.from(data, "base64url").toString());
  if (typeof payload.expires !== "number" || payload.expires < Date.now()) throw new PreviewError(410, "This preview has expired. Create a new photo preview.");
  return payload;
}
export function offer3d(image: string): RenderOffer | null {
  const provider = configuredProvider();
  if (!provider) return null;
  return { provider, label: FAL_MODELS[provider].label, ticket: sign({ kind: "preview", digest: createHash("sha256").update(image).digest("hex"), provider, expires: Date.now() + 60 * 60_000 }) };
}
export function validatePreview(image: string, ticket: string) {
  const parsed = previewSchema.safeParse(verify(ticket));
  if (!parsed.success || parsed.data.digest !== createHash("sha256").update(image).digest("hex")) throw new PreviewError(403, "Use the photo preview created for this outfit.");
  return parsed.data;
}
export function readJob(token: string) {
  const parsed = jobSchema.safeParse(verify(token));
  if (!parsed.success) throw new PreviewError(403, "This 3D preview link is invalid.");
  return parsed.data;
}
async function upstream(url: string, body?: object) {
  const key = process.env.FAL_KEY;
  if (!key) throw new PreviewError(503, "The 3D service is not configured.");
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store", signal: AbortSignal.timeout(body ? 60_000 : 30_000),
  });
  if (!response.ok) {
    if (response.status === 429) throw new PreviewError(429, "The 3D service is busy. Try again shortly.");
    if ([401, 402, 403].includes(response.status)) throw new PreviewError(503, "The 3D service is temporarily unavailable.");
    if (response.status === 422) throw new PreviewError(422, "The 3D service could not process this preview. Try a new photo preview.");
    throw new PreviewError(502, "The 3D service could not be reached. Try checking again.");
  }
  return response.json();
}
// Coalesce repeat clicks on the same preview. Only hashes and task tokens are kept.
// This is an instance-local cost guard; production needs a shared quota/firewall.
const submissions = new Map<string, { expires: number; task: Promise<string> }>();
export async function submit3d(image: string, ticket: string) {
  const preview = validatePreview(image, ticket);
  const now = Date.now();
  for (const [key, entry] of submissions) if (entry.expires <= now) submissions.delete(key);
  const existing = submissions.get(ticket);
  if (existing) return existing.task;
  if (submissions.size >= 500) throw new PreviewError(429, "The 3D fitting room is busy. Try again later.");
  const task = (async () => {
    // Each provider is capped near 40k vertices/faces so the GLB stays light enough for phones.
    const input = {
      trellis: { image_url: image, resolution: 1024, decimation_target: 40000, texture_size: 1024 },
      meshy: { image_url: image, model_type: "standard", geometry_resolution: "standard", should_texture: true, enable_pbr: false, should_remesh: true, target_polycount: 40000, enable_safety_checker: true },
      hunyuan: { input_image_url: image, generate_type: "Normal", enable_pbr: false, face_count: 40000 },
    }[preview.provider];
    const result = await upstream(`https://queue.fal.run/${FAL_MODELS[preview.provider].endpoint}`, input);
    const id = z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/).parse(result.request_id);
    return sign({ kind: "job", id, provider: preview.provider, expires: now + 24 * 60 * 60_000 });
  })();
  submissions.set(ticket, { expires: preview.expires, task });
  // Retain ambiguous failures rather than automatically issuing another paid job.
  return task;
}
function modelUrl(value: unknown) {
  const url = z.string().url().parse(value);
  if (new URL(url).protocol !== "https:") throw new PreviewError(502, "The 3D service returned an invalid model.");
  return url;
}
export async function status3d(token: string): Promise<RenderStatus> {
  const job = readJob(token);
  const queue = FAL_MODELS[job.provider].queue;
  const result = await upstream(`${queue}/${job.id}/status`);
  if (result.status === "COMPLETED") {
    const failed = { status: "failed", error: "The 3D model could not be created. Try a new photo preview." } as const;
    if (result.error) return failed;
    // fal marks failed jobs COMPLETED and answers their result with an HTTP error, which retrying never fixes.
    const output = await upstream(`${queue}/${job.id}`).catch((error) => {
      if (error instanceof PreviewError && (error.status === 422 || error.status === 502)) return null;
      throw error;
    });
    if (!output || output.error || !output.model_glb?.url) return failed;
    return { status: "ready", modelUrl: modelUrl(output.model_glb.url) };
  }
  if (!["IN_QUEUE", "IN_PROGRESS"].includes(result.status)) throw new PreviewError(502, "The 3D service returned an unreadable status.");
  return { status: result.status === "IN_QUEUE" ? "queued" : "processing" };
}
export async function readJson(request: Request, maxBytes: number) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new PreviewError(403, "Open the fitting room from this site.");
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new PreviewError(400, "Send a preview from the fitting room.");
  if (Number(request.headers.get("content-length")) > maxBytes) throw new PreviewError(413, "This preview is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new PreviewError(400, "The preview is missing.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new PreviewError(413, "This preview is too large."); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
export function reply(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
export function failure(error: unknown) {
  if (error instanceof PreviewError) return reply({ error: error.message }, error.status);
  if (error instanceof SyntaxError || error instanceof z.ZodError) return reply({ error: "The 3D preview request is invalid." }, 400);
  return reply({ error: "The 3D service could not be reached. Try checking again." }, 502);
}
