import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    sourcemap: false,
  },
  server: {
    port: 5173,
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
