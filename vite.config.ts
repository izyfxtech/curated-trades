import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackStart({
      // Redirect TanStack Start's bundled server entry to src/server.ts,
      // our SSR wrapper that recovers h3-swallowed errors into a real page.
      server: { entry: "server" },
    }),
    // Nitro's default preset (node-server) is the most portable target —
    // deployable to a plain Node process, Docker, Railway, or Vercel/Netlify
    // via their own adapters. Switch presets here if deploying to Cloudflare
    // Workers etc. — see https://nitro.build/deploy for the full list.
    nitro(),
    viteReact(),
  ],
  resolve: {
    // Reads the "paths" mapping straight from tsconfig.json (the @/* alias) —
    // native as of Vite 8, replacing the vite-tsconfig-paths plugin.
    tsconfigPaths: true,
    // Prevent duplicate React instances if any dependency resolves its own copy.
    dedupe: ["react", "react-dom"],
  },
});
