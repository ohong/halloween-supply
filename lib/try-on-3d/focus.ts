import type { FocusPiece } from "./types";

// Bounds are fractions of a standing model's height and width, not garment
// segmentation. Unknown accessories keep a whole-body frame rather than guessing.
export type FocusRegion = { bottom: number; top: number; width: number; yaw: number };
const whole: FocusRegion = { bottom: 0, top: 1, width: 1, yaw: .12 };
export function focusRegion(piece?: FocusPiece): FocusRegion {
  if (!piece) return whole;
  const text = `${piece.name} ${piece.category ?? ""}`.toLowerCase();
  if (/hat|headwear|crown|wig|helmet|headband|ears/.test(text)) return { bottom: .89, top: 1.02, width: .65, yaw: -.24 };
  if (/mask|glasses|eyewear/.test(text)) return { bottom: .78, top: .94, width: .45, yaw: -.12 };
  if (/boot|shoe|footwear|sneaker|heel/.test(text)) return { bottom: 0, top: .22, width: .85, yaw: .32 };
  if (/scarf|neckerchief|necklace|choker|bow tie|necktie/.test(text)) return { bottom: .56, top: .88, width: .65, yaw: -.12 };
  if (/trouser|pants|bottoms|skirt|shorts|legging/.test(text)) return { bottom: .14, top: .57, width: .85, yaw: .20 };
  if (/belt|sash/.test(text)) return { bottom: .45, top: .61, width: .85, yaw: .14 };
  if (/coat|dress|cape|robe|sheet|jumpsuit|overalls/.test(text)) return { bottom: .12, top: .88, width: 1, yaw: -.18 };
  if (/jacket|shirt|vest|top|outerwear|blouse|sweater|corset/.test(text)) return { bottom: .43, top: .86, width: 1, yaw: -.22 };
  return whole;
}
