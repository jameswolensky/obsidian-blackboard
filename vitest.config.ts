import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, "test/__mocks__/obsidian.ts"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["test/setup.ts"],
  },
});
