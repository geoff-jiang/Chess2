import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/socket": {
        target: "ws://localhost:8787",
        ws: true,
      },
    },
  },
});
