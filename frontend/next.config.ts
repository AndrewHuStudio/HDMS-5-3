import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    // 在客户端构建时忽略 Node.js 专用模块
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        ws: false,
      };
    }
    return config;
  },
};

export default nextConfig;
