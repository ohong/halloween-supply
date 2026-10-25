import { createPair, failure, reply, sameOrigin } from "@/lib/phone-camera/server";
export async function POST(request: Request) {
  try { sameOrigin(request); return reply(await createPair()); }
  catch (error) { return failure(error); }
}
