import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": PROJECT_ROOT,
    },
  },
  test: {
    environment: "node",
  },
});
