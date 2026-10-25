import { z } from "zod";

// Keep appearance data bounded and separate from catalog identity and prices.
export const appearanceSchema = z.record(z.string().min(1).max(150), z.object({
  color: z.string().trim().min(1).max(40).regex(/^[a-zA-Z -]+$/).optional(),
  style: z.string().trim().min(1).max(100).regex(/^[a-zA-Z0-9 ,.'-]+$/).optional(),
}).strict()).refine(value => Object.keys(value).length <= 20);
