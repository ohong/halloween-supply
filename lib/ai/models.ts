import { anthropic } from "@ai-sdk/anthropic";

/** The one place the model is chosen. Claude Sonnet 5.5 on the direct Anthropic API. */
export const SONNET_MODEL_ID = "claude-sonnet-5-5";

export const sonnet = () => anthropic(SONNET_MODEL_ID);
