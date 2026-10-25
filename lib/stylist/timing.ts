import type { Product } from "@/lib/types";

/** Only an explicit lower bound can rule an item out. "Within" and "up to"
 * describe upper bounds, so they cannot establish that an item is already late. */
export function minimumLeadDays(description: string): number | null {
  const durations: number[] = [];
  const patterns = [
    /(?:lead[ -]?time|turnaround|creation(?: time)?|production(?: time)?|processing(?: time)?|dispatch(?: time)?|shipping(?: time)?|delivery(?: time)?|ships?|dispatches?|delivers?|made[ -]to[ -]order)([^.!?]{0,55}?)(?<![\d.])(\d{1,3}(?:\.\d{1,3})?)(?:\s*(?:[-–—]|to)\s*\d{1,3}(?:\.\d{1,3})?)?\s*(?:(?:business|working)\s*)?(days?|weeks?|months?)\b/gi,
    /(?<![\d.])(\d{1,3}(?:\.\d{1,3})?)(?:\s*(?:[-–—]|to)\s*\d{1,3}(?:\.\d{1,3})?)?\s*(?:(?:business|working)\s*)?(days?|weeks?|months?)[ -]+(?:lead[ -]?time|turnaround|creation|production|processing|dispatch)\b/gi,
  ];
  for (const [index, pattern] of patterns.entries()) {
    for (const match of description.matchAll(pattern)) {
      const prefix = index === 0 ? match[1] : description.slice(Math.max(0, match.index! - 20), match.index!);
      const upperBound = /\b(?:within|up to|under|less than|maximum|no more than|at most)\b/i.test(prefix);
      const uncertain = /\b(?:typically|approximately|estimated|about|around|roughly|usually|may take)\b/i.test(prefix);
      if (upperBound || uncertain) continue;
      const quantity = Number(match[index === 0 ? 2 : 1]);
      const unit = match[index === 0 ? 3 : 2].toLowerCase();
      // Calendar days are a conservative minimum for business days. A month is
      // never shorter than 28 days. Missing transit time is never invented.
      const days = Math.ceil(quantity * (unit.startsWith("week") ? 7 : unit.startsWith("month") ? 28 : 1));
      if (days > 0) durations.push(days);
    }
  }
  return durations.length ? Math.max(...durations) : null;
}

export function isExplicitlyTooLate(product: Product, eventDate: string, now = Date.now()): boolean {
  if (!eventDate) return false;
  const minimum = minimumLeadDays(product.description);
  // Give the event date a full extra day for timezone and dispatch-day ambiguity.
  // Exclusion is deliberately conservative; inclusion never confirms delivery.
  const latestEvent = Date.parse(`${eventDate}T23:59:59Z`) + 86_400_000;
  if (minimum !== null && now + minimum * 86_400_000 > latestEvent) return true;
  const statedDate = product.description.match(/\b(?:ships?|dispatch(?:es)?|releases?|available(?: from| on)?|shipping (?:starts|begins))\s*(?:(?:on|from|after|starting)\s*)?[:\-]?\s*(20\d{2}-\d{2}-\d{2})\b/i)?.[1];
  return Boolean(statedDate && Date.parse(`${statedDate}T00:00:00Z`) > latestEvent);
}
