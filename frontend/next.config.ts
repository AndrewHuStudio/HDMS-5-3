import type { NextConfig } from "next";
import fs from "node:fs";
import path from "node:path";

function loadTestEnvFile() {
  const envFilePath = path.join(process.cwd(), ".env.test");
  if (!fs.existsSync(envFilePath)) {
    return;
  }

  const envFileContent = fs.readFileSync(envFilePath, "utf8");
  for (const line of envFileContent.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      continue;
    }

    const normalizedLine = trimmedLine.startsWith("export ")
      ? trimmedLine.slice(7).trim()
      : trimmedLine;
    const separatorIndex = normalizedLine.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    let value = normalizedLine.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value.replace(/\\n/g, "\n");
  }
}

loadTestEnvFile();

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
