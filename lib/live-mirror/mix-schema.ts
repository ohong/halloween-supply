import { z } from "zod";
const id = z.string().min(1).max(150);
export const mixSchema = z.object({ costumeSlug: id, pieceId: id, productId: id, replacesPieceId: id.nullable() }).strict();
