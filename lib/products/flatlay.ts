/** Small finishing pieces should not appear as large as the garments beside them. */
export function flatlayScale(piece: { name: string }): number {
  if (/brooch|fastener|shawl pin/i.test(piece.name)) return 0.5;
  if (/antenna/i.test(piece.name)) return 0.7;
  if (/neckerchief|fur collar/i.test(piece.name)) return 0.8;
  return 1;
}
