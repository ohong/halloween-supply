/** Discovery can be useful before a merchant confirms price, stock or sizes. */
export interface ScreenshotMatch {
  title: string;
  url: string;
  merchant: string;
  image: string | null;
  priceCents: number | null;
  currency: string | null;
  availability: "in_stock" | "out_of_stock" | "unknown";
  kind: "product" | "browse";
  note: string;
}
