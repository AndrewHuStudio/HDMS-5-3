import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Turbopack ignores the `webpack` alias below; configure it explicitly for `next build`.
    resolveAlias: {
      // Keep this as a relative path so Turbopack doesn't emit a Windows absolute import.
      canvas: "./lib/canvas-shim.ts",
    },
  },
  webpack: (config, { isServer }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    };

    // 在客户端构建时忽略 Node.js 专用模块
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        ws: false,
        canvas: false,
      };
    }
    return config;
  },
};

export default nextConfig;
