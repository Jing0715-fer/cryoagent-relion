import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Disable expensive dev optimizations that use extra memory
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
