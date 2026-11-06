import type { KitDefinition } from "../../lib/kits/types";
import researchA from "./research/a.json";
import researchB from "./research/b.json";
import researchC from "./research/c.json";
import researchD from "./research/d.json";

/** Explicit product choices preserve the reviewed composition as catalog prices change. */
export const KITS = [...researchA, ...researchB, ...researchC, ...researchD] as unknown as KitDefinition[];
