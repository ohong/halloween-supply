import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { CartItem } from "../types";
import { validateCustomItem } from "./validate";

const temporaryKey = randomBytes(32).toString("hex");
function signingKey() {
  const key = process.env.SAVED_LOOK_SIGNING_SECRET || process.env.TURSO_AUTH_TOKEN;
  return key || (process.env.NODE_ENV === "production" ? undefined : temporaryKey);
}
function payload(item: CartItem) { return JSON.stringify(validateCustomItem({ ...item, size: null })); }
export function isSourcedItemSigningAvailable() { return Boolean(signingKey()); }
/** The purpose prefix isolates credential use. Unconfigured saving never blocks discovery or invents a receipt. */
export function signSourcedItem(item: CartItem): string | undefined {
  const key = signingKey();
  return key ? createHmac("sha256", key).update("saved-look-item-v1\n" + payload(item)).digest("hex") : undefined;
}
export function verifySourcedItem(item: CartItem, proof: string | undefined) {
  if (!proof || !/^[a-f0-9]{64}$/.test(proof)) return false;
  const signed = signSourcedItem(item);
  if (!signed) return false;
  const expected = Buffer.from(signed, "hex"), actual = Buffer.from(proof, "hex");
  return timingSafeEqual(expected, actual);
}
