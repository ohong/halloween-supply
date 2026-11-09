import { checkBotId } from "botid/server";
import { captureError } from "@/lib/errors";

// Bot check for routes that spend provider money or start checkout. Call it first in POST, before guardProvider
// and before reading the body:
//   const blocked = await rejectBot();
//   if (blocked) return blocked;
// The routes it protects are listed in instrumentation-client.ts (initBotId); keep the two lists in step.
// On by default. BOT_CHECK_DISABLED=1 turns it off (hosted e2e scripts are bots; see docs/deployment.md).
// In development BotID reports a human; elsewhere off Vercel the check throws and fails open, so enforcement is only real on a Vercel deployment.

/** Null when the request may proceed, otherwise the 403 response to return. */
export async function rejectBot(): Promise<Response | null> {
  if (process.env.BOT_CHECK_DISABLED === "1") return null;
  try {
    const { isBot } = await checkBotId();
    if (!isBot) return null;
  } catch (error) {
    // Fail open: a BotID outage must not take down checkout and try-on.
    console.error("[bot-guard] BotID check failed; allowing request", error instanceof Error ? error.name : "UnknownError");
    await captureError(error, { source: "bot-guard" });
    return null;
  }
  return Response.json(
    { status: "error", error: "bot_detected", message: "Automated traffic isn't allowed here." },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}
