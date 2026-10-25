export type WearerAudience = "adult" | "child" | "toddler" | "infant" | "pet" | "doll";

/** Reject explicit incompatible sizing before a semantic match can approve it. */
export function supportsWearerAudience(title: string, audience: WearerAudience = "adult"): boolean {
  // These colors, character names and garment cuts do not name the intended wearer.
  const claim = title
    .replace(/\bbaby\s+(?:blue|pink|yoda)\b/gi, "")
    .replace(/\bbaby[ -]?doll(?=\s+(?:dress|top|blouse|nightgown|costume)\b)/gi, "");
  const adultEligible = /\badults?\b/i.test(claim);
  const groups: WearerAudience[] = [];
  if (/\b(?:baby|babies|infants?|newborns?)\b/i.test(claim)) groups.push("infant");
  if (/\btoddlers?\b/i.test(claim)) groups.push("toddler");
  if (/\b(?:child|children|kids?|youth|juniors?)\b/i.test(claim)) groups.push("child");
  if (/\b(?:pets?|for\s+(?:dogs?|cats?|puppies|kittens)|(?:dog|cat|puppy|kitten)\s+(?:clothes|clothing|apparel|sweater|hoodie))\b/i.test(claim)) groups.push("pet");
  if (/\b(?:for\s+(?:dolls?|barbie)|doll(?:['’]s)?\s+(?:clothes|clothing|outfit|dress|hat|shoes|boots)|doll[ -]sized?)\b/i.test(claim)) groups.push("doll");
  if (/\badults?\b/i.test(claim)) groups.push("adult");
  // A family listing may explicitly offer adult sizes; semantic review still checks its selected variant.
  return groups.every((group) => group === audience ||
    (audience === "adult" && adultEligible && ["infant", "toddler", "child"].includes(group)));
}
