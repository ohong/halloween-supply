import { z } from "zod";
import { failure, readJson, reply, submit3d } from "@/lib/try-on-3d/server";
export const maxDuration = 90;
// Vercel rejects function request bodies over 4.5 MB before they reach this handler.
const schema = z.object({ image: z.string().max(4_400_000).startsWith("data:image/jpeg;base64,"), ticket: z.string().max(2000), consent: z.literal(true) }).strict();
export async function POST(request: Request) {
  try {
    const { image, ticket } = schema.parse(await readJson(request, 4_500_000));
    return reply({ token: await submit3d(image, ticket) }, 202);
  } catch (error) { return failure(error); }
}
