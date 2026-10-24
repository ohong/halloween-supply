// Cached structured-output call to Claude (AI SDK 7: generateText + Output.object).
import { generateText, Output } from "ai";
import type { z } from "zod";
import { sonnet, SONNET_MODEL_ID } from "../ai/models";
import { cached } from "./cache";

export async function askObject<S extends z.ZodType>(args: {
  /** Cache namespace label, e.g. "decompose". */
  label: string;
  schema: S;
  instructions: string;
  prompt: string;
}): Promise<z.infer<S>> {
  return cached<z.infer<S>>("claude", { label: args.label, model: SONNET_MODEL_ID, i: args.instructions, p: args.prompt }, async () => {
    const { output } = await generateText({
      model: sonnet(),
      output: Output.object({ schema: args.schema }),
      instructions: args.instructions,
      prompt: args.prompt,
    });
    return output as z.infer<S>;
  });
}
