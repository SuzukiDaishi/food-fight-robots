import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  // Disable image optimization since we are using export
  images: {
    unoptimized: true,
  }
};

export default nextConfig;
