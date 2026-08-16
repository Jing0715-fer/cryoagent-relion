import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Memory: disable source maps + file tracing in dev
  productionBrowserSourceMaps: false,
  outputFileTracing: false,
};

export default nextConfig;
