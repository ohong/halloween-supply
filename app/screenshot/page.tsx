import type { Metadata } from "next";
import { ScreenshotCostume } from "@/components/store/screenshot-costume";

export const metadata: Metadata = {
  title: "Screenshot to costume · halloween.supply",
  description: "Drop in any screenshot. We spot the look, break it into pieces and find each one in stock.",
};

export default function ScreenshotPage() {
  return <ScreenshotCostume />;
}
