export type RenderProvider = "trellis" | "meshy" | "hunyuan";
export type RenderOffer = { ticket: string; provider: RenderProvider; label: string };
export type FocusPiece = { id: string; name: string; category?: string };
export type RenderStatus =
  | { status: "queued" | "processing"; progress?: number }
  | { status: "ready"; modelUrl: string }
  | { status: "failed"; error: string };
