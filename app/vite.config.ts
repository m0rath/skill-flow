import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Injects the Content-Security-Policy only into the production build.
 * Dev keeps a relaxed policy so Vite's HMR client and React Refresh can run.
 * Keep the host list in sync with `public/_headers`.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self' https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com https://api.github.com https://raw.githubusercontent.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
  "img-src 'self' data: blob: https://*.google-analytics.com https://*.googletagmanager.com",
  "media-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function cspPlugin(): Plugin {
  return {
    name: "justools-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

/**
 * Group third-party code into stable vendor chunks so app code can be cached
 * and downloaded independently of the libraries.
 */
function manualChunks(id: string): string | undefined {
  if (!id.includes("node_modules")) return undefined;
  if (id.includes("jszip")) return "vendor-jszip";
  if (id.includes("html-to-image")) return "vendor-html-to-image";
  if (id.includes("motion")) return "vendor-motion";
  if (id.includes("react-router") || id.includes("@remix-run")) return "vendor-router";
  if (id.includes("react-dom") || id.includes("scheduler") || /node_modules[\\/]react[\\/]/.test(id)) {
    return "vendor-react";
  }
  if (id.includes("zustand")) return "vendor-zustand";
  return "vendor";
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cspPlugin()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Vite serves an SPA by default: deep links like /skill-flow fall back to
  // index.html in dev and in `vite preview`.
  server: {
    port: 5173,
  },
  preview: {
    port: 5173,
  },
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
});
