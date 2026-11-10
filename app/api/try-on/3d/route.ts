import { z } from "zod";
import { failure, readJson, reply, submit3d } from "@/lib/try-on-3d/server";
import { rejectBot } from "@/lib/bot-guard";
import { guardProvider, UNAVAILABLE } from "@/lib/guard";
export const maxDuration = 90;
const guard = guardProvider("try-on-3d", { maxActive: 4 });
// Vercel rejects function request bodies over 4.5 MB before they reach this handler.
const schema = z.object({ image: z.string().max(4_400_000).startsWith("data:image/jpeg;base64,"), ticket: z.string().max(2000), consent: z.literal(true) }).strict();
export async function POST(request: Request) {
  const blocked = await rejectBot();
  if (blocked) return blocked;
  const release = guard.acquire();
  if (release === "disabled") return reply({ error: UNAVAILABLE }, 503);
  if (release === "busy") return reply({ error: "The 3D preview is busy. Please try again shortly." }, 429);
  try {
    const { image, ticket } = schema.parse(await readJson(request, 4_500_000));
    return reply({ token: await submit3d(image, ticket) }, 202);
  } catch (error) { return failure(error); } finally { release(); }
}
