import { ImageResponse } from "next/og";

export const alt = "Halloween Supply — costume ideas built from individual pieces";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "80px", background: "#fff", color: "#111", fontFamily: "sans-serif" }}>
    <div style={{ fontSize: 30, marginBottom: 36 }}>halloween.supply</div>
    <div style={{ fontSize: 76, lineHeight: 1.1 }}>What will you be?</div>
    <div style={{ fontSize: 34, color: "#666", marginTop: 36 }}>Halloween costume ideas, built from pieces.</div>
  </div>, size);
}
