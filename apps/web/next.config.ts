import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No floating "N" badge in dev: it covers the alert toasts in the corner.
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
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
