import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "postcss";

// Every fixed UI font size grows by --ui-font-bump (src/styles/index.css), so
// text size is one token instead of hundreds of text-[12px] classes. Relative
// sizes (em, %) already follow their parent and are left alone.
const BUMPABLE_FONT_SIZE = /^(?:\d*\.?\d+(?:px|rem)|var\(--text-[\w-]+\))$/;

const uiFontBump: Plugin = {
  postcssPlugin: "irgatos-ui-font-bump",
  Declaration: {
    "font-size"(decl) {
      const value = decl.value.trim();
      if (!BUMPABLE_FONT_SIZE.test(value)) return;
      decl.value = `calc(${value} + var(--ui-font-bump, 0px))`;
    },
  },
};

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async ({ mode }) => {
  const stable = mode === "stable";

  return {
    plugins: [react(), tailwindcss()],
    clearScreen: false,
    css: { postcss: { plugins: [uiFontBump] } },
    build: {
      rollupOptions: {
        // The quick composer panel loads its own page so it does not boot the
        // whole workspace.
        input: {
          main: "index.html",
          quickComposer: "quick-composer.html",
          irgatChat: "irgat-chat.html",
          // Browser access: the page phones and tablets open over Tailscale.
          web: "web.html",
        },
      },
    },
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: stable
        ? false
        : host
          ? {
              protocol: "ws",
              host,
              port: 1421,
            }
          : undefined,
      watch: {
        ignored: stable ? ["**/*"] : ["**/src-tauri/**"],
      },
    },
  };
});
