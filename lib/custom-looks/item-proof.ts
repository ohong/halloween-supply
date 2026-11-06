import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { CartItem } from "../types";
import { validateCustomItem } from "./validate";

const temporaryKey = randomBytes(32).toString("hex");
function signingKey() {
  const key = process.env.SAVED_LOOK_SIGNING_SECRET || process.env.TURSO_AUTH_TOKEN;
  if (!key && process.env.NODE_ENV === "production") throw new Error("Saved-look signing is unavailable.");
  return key || temporaryKey;
}
function payload(item: CartItem) { return JSON.stringify(validateCustomItem({ ...item, size: null })); }
/** The purpose prefix separates these receipts from other uses of the server credential. */
export function signSourcedItem(item: CartItem) { return createHmac("sha256", signingKey()).update("saved-look-item-v1\n" + payload(item)).digest("hex"); }
export function verifySourcedItem(item: CartItem, proof: string) {
  if (!/^[a-f0-9]{64}$/.test(proof)) return false;
  const expected = Buffer.from(signSourcedItem(item), "hex"), actual = Buffer.from(proof, "hex");
  return timingSafeEqual(expected, actual);
}
