import { anthropic } from "@ai-sdk/anthropic";

/**
 * The one place models are chosen. Every model or provider endpoint id in the app lives here;
 * ESLint bans these string shapes elsewhere. Env overrides are read at call time.
 */

// Anthropic: Claude Sonnet 5.5 on the direct Anthropic API.
export const SONNET_MODEL_ID = "claude-sonnet-5-5";
export const sonnet = () => anthropic(SONNET_MODEL_ID);

// OpenAI text/vision: one model, with per-purpose env overrides.
export const OPENAI_LUNA_MODEL = "gpt-6-luna";
export const SCREENSHOT_VISION_MODEL = OPENAI_LUNA_MODEL;
export const STYLIST_COMPARE_MODEL = OPENAI_LUNA_MODEL;
export const SOURCING_DISCOVERY_MODEL = OPENAI_LUNA_MODEL;
export const openaiDecisionModel = () => process.env.OPENAI_DECISION_MODEL || OPENAI_LUNA_MODEL;
export const openaiMirrorVisionModel = () => process.env.OPENAI_MIRROR_VISION_MODEL || OPENAI_LUNA_MODEL;
export const openaiMirrorReasoningModel = () => process.env.OPENAI_MIRROR_REASONING_MODEL || OPENAI_LUNA_MODEL;

// OpenAI realtime voice and image generation.
export const openaiLiveVoiceModel = () => process.env.OPENAI_LIVE_MODEL || "gpt-live-1";
export const openaiImageModel = () => process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-flare";

// fal / Decart live video mirror.
export const VIDEO_MODEL = "decart/lucy-2-5/realtime";

// fal 3D preview models: queue endpoint ids and the request-status base path.
export const FAL_3D_MODELS = {
  meshy: { endpoint: "meshy/v7.1/image-to-3d", queue: "meshy/v7.1", label: "fal / Meshy 7.1" },
  hunyuan: { endpoint: "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d", queue: "fal-ai/hunyuan-3d", label: "fal / Hunyuan 3D 3.1 Pro" },
  trellis: { endpoint: "fal-ai/trellis-2", queue: "fal-ai/trellis-2", label: "fal / TRELLIS.2" },
} as const;
