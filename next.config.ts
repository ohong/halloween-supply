import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  outputFileTracingIncludes: {
    "/api/try-on": ["./public/costumes/**", "./public/products/**"],
    "/api/live-mirror/reference": ["./public/products/**"],
    "/api/outfits": ["./public/costumes/**", "./public/products/price-tiers/**"],
    "/api/chat": ["./public/costumes/**", "./public/products/price-tiers/**"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
