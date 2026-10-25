import { z } from "zod";
import { failure, readJson, reply, status3d } from "@/lib/try-on-3d/server";
export const maxDuration = 90;
export async function POST(request: Request) {
  try {
    const { token } = z.object({ token: z.string().max(2000) }).strict().parse(await readJson(request, 3000));
    return reply(await status3d(token));
  } catch (error) { return failure(error); }
}
