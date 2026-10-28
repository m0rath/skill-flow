import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
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
  "connect-src 'self' https://api.anthropic.com https://api.openai.com https://api.mistral.ai https://generativelanguage.googleapis.com https://api.github.com https://raw.githubusercontent.com https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
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
 * Serve the Netlify Function at the same `/api/demo` URL during `vite dev`.
 * This keeps the browser client identical in development and production; production uses
 * Netlify's function runtime instead.
 */
function demoApiPlugin(env: Record<string, string>): Plugin {
  return {
    name: "justools-demo-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/demo", async (req, res, next) => {
        if (req.method !== "POST" && req.method !== "GET") return next();
        try {
          for (const key of ["DEMO_MISTRAL_API_KEY", "DEMO_GEMINI_API_KEY", "DEMO_IP_SALT"]) {
            if (!process.env[key] && env[key]) process.env[key] = env[key];
          }
          const mod = (await import(new URL("./netlify/functions/demo.mjs", import.meta.url).href)) as {
            default: (request: Request, context: { ip?: string }) => Promise<Response>;
          };
          const suffix = req.url && req.url !== "/" ? req.url : "";
          const headers = new Headers();
          Object.entries(req.headers).forEach(([key, value]) => {
            if (typeof value === "string") headers.set(key, value);
            else if (Array.isArray(value)) headers.set(key, value.join(", "));
          });
          const chunks: Buffer[] = [];
          if (req.method !== "GET") {
            for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const request = new Request(new URL(`/api/demo${suffix}`, `http://${req.headers.host || "localhost"}`), {
            method: req.method,
            headers,
            body: req.method === "GET" ? undefined : Buffer.concat(chunks),
          });
          const response = await mod.default(request, { ip: req.socket.remoteAddress || "127.0.0.1" });
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          if (!response.body) {
            res.end();
            return;
          }
          const reader = response.body.getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(Buffer.from(value));
            }
          } finally {
            reader.releaseLock();
          }
          res.end();
        } catch (e) {
          next(e);
        }
      });
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
export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL(".", import.meta.url));
  const env = loadEnv(mode, root, "");
  return {
    plugins: [react(), cspPlugin(), demoApiPlugin(env)],
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
  };
});
