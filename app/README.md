# justools — app

The React + TypeScript single-page app behind **justools**: visual tools for AI agent skills, workflows and software codebases.

It ships two tools:

- **Skill Flow Mapper** (`/skill-flow`) — map, question and fix a Claude skill or Markdown playbook.
- **Project Flow Mapper** (`/project-flow`) — open a whole project folder, see its architecture and flows, then question and fix it.

> The original vanilla-JS app lives in the repository root `public/` and is kept as a read-only reference. This package (`app/`) is the port.

## Stack

Vite 8 · React 19 · TypeScript 5.9 · React Router 7 · Zustand 5 · `motion` · `jszip` · `html-to-image` · Netlify Functions 2.0 · Netlify Blobs.

## Prerequisites

- Node.js **>= 20** (`engines.node`).
- npm (bundled with Node). No package manager pin beyond the committed `package-lock.json`.

The static app builds with no secrets. The **shared demo** needs two provider keys in the server environment; without them the demo reports itself as unavailable and users can still bring their own key. See [Configuration](#configuration).

## Scripts

Run all commands from `app/`.

| Script                 | What it does                                        |
| ---------------------- | --------------------------------------------------- |
| `npm run dev`          | Start the Vite dev server on http://localhost:5173. |
| `npm run build`        | Type-check (`tsc -b`) then build to `dist/`.        |
| `npm run preview`      | Serve the production build locally (port 5173).     |
| `npm run typecheck`    | `tsc -b --noEmit`.                                  |
| `npm test`             | Node test runner: demo proxy validation/limits.     |
| `npm run lint`         | ESLint (flat config).                               |
| `npm run lint:fix`     | ESLint with `--fix`.                                |
| `npm run format`       | Prettier write (`printWidth` 120).                  |
| `npm run format:check` | Prettier check.                                     |

## Routes

| Path                                                 | Page                    |
| ---------------------------------------------------- | ----------------------- |
| `/`                                                  | Hub landing page        |
| `/skill-flow`                                        | Skill Flow Mapper       |
| `/project-flow`                                      | Project Flow Mapper     |
| `/skill-flow-mapper`, `/project-flow-mapper`, `/hub` | Redirects (legacy URLs) |
| `*`                                                  | 404 page                |

Route pages are code-split with `React.lazy` + `<Suspense>`; each tool is fetched on first visit. The app is wrapped in a root `ErrorBoundary` so a render crash shows a recovery screen instead of a blank page.

## Structure

```
app/
  index.html            # document shell, meta/OG/Twitter tags
  vite.config.ts        # React, production CSP, local /api/demo middleware
  netlify/functions/    # demo.mjs — hidden-key AI proxy + rate limits
  test/                 # node:test coverage for the demo proxy
  src/
    main.tsx            # entry: mounts <ErrorBoundary><App/></ErrorBoundary>
    App.tsx             # router, lazy routes, theme + AI-store bootstrap
    components/         # AppShell, Header, DemoBanner, ErrorBoundary, icons, modals
    features/           # hub, skill-flow, project-flow views
    store/              # Zustand stores (app theme/toasts, AI settings, tools)
    ai/ model/ lib/     # provider clients (incl. demo client), analysis model, helpers
    styles/             # legacy.css (tokens/design system) + app.css
  public/               # static assets, _headers, _redirects, fonts, favicon
```

Design tokens (`--paper`, `--surface`, `--ink`, `--muted`, `--line`, `--step`, …) live in `src/styles/legacy.css` and drive both light and dark themes.

## Configuration

### Demo AI (no user key)

On first load the app selects **Try the demo**. Requests go to the same-origin `/api/demo` route, which Netlify rewrites to `netlify/functions/demo.mjs`. The function validates the request, applies rate limits, adds the hidden provider key and streams the upstream response back. The browser never receives a provider key.

Supported demo models:

| Model                   | Label                 | Provider |
| ----------------------- | --------------------- | -------- |
| `mistral-small-2603`    | Mistral Small 4       | Mistral  |
| `gemini-3.5-flash-lite` | Gemini 3.5 Flash-Lite | Google   |

Set these environment variables in **Netlify → Project configuration → Environment variables** (and locally in `app/.env.local` if you want to test the proxy):

| Variable               | Required | Purpose                                                      |
| ---------------------- | -------- | ------------------------------------------------------------ |
| `DEMO_MISTRAL_API_KEY` | Yes*     | Server-side Mistral key.                                     |
| `DEMO_GEMINI_API_KEY`  | Yes*     | Server-side Gemini key.                                      |
| `DEMO_IP_SALT`         | No       | Stable salt for hashing visitor IPs before storing counters. |

\*Both demo models are always offered in the UI. If a provider key is missing, requests to that model return a clear “demo unavailable” error.

Local setup:

```bash
cp .env.example .env.local
# fill in DEMO_MISTRAL_API_KEY and DEMO_GEMINI_API_KEY
npm run dev
```

`vite.config.ts` serves the same function at `/api/demo` in development, so the client code is identical in development and production. `npm run preview` serves the built files without that middleware; use `npm run dev` (or `netlify dev`) when testing demo requests.

**Privacy:** demo prompts are sent to Mistral or Google under their free-tier terms and may be used to improve their models. The UI shows a small banner while the demo is selected and recommends bringing your own key for private code. Do not paste secrets into the demo. The function logs only request metadata (provider, model, sizes and latency) — never prompt text. Netlify still records normal request metadata.

**Limits** (enforced in `demo.mjs`): 6 requests/minute and 12 requests/day per IP, plus a 500 requests/day global budget. Netlify also applies a 20 requests/day per-IP platform backstop. Counters use Netlify Blobs with strong consistency when available, with an in-memory fallback for local development. Adjust the constants at the top of `demo.mjs` if needed.

### Bring your own key (BYO)

Users can instead choose Anthropic, OpenAI, Gemini or Mistral in **AI settings** and enter their own key. Keys and model choices are stored in the browser only:

- `skillflow:theme` (localStorage) — light/dark preference.
- `skillflow:ai` (localStorage) / `skillflow:keys` (sessionStorage) — provider, model and API keys.

BYO keys are never bundled or committed. The Content-Security-Policy in `vite.config.ts`/`public/_headers` allowlists the provider API hosts, including `https://api.mistral.ai`.

## Deployment

`npm run build` emits a static SPA into `dist/`. CI (`.github/workflows/ci.yml`) checks both the legacy reference app and this package; `.github/workflows/deploy-netlify.yml` builds `app/` and publishes `app/dist/` plus `app/netlify/functions/` to Netlify on every push to `main`, after the checks pass. Manual `workflow_dispatch` runs are supported.

Netlify-specific files:

- `netlify.toml` sets `base = "app"`, `publish = "dist"`, and the functions directory. It intentionally has **no** redirects.
- `public/_redirects` (copied to `dist/_redirects`) is the single source of truth: it rewrites `/api/demo` → `/.netlify/functions/demo` before the SPA fallback. Keeping a duplicate in `netlify.toml` is a trap — Netlify processes `_redirects` first, and its de-duplication can move the TOML copy behind the `/*` catch-all.
- Set the demo environment variables in Netlify before deploying; `demo.mjs` returns `demo_unavailable` until the selected provider key exists.
- The deploy workflow installs a pinned current Netlify CLI so Functions 2.0 config and Blobs are bundled correctly, then deploys with `--no-build --skip-functions-cache` after CI has already built the app.

For any other static host, publish `dist/` with a single-page fallback to `index.html`:

- Vite copies `public/_redirects` and `public/_headers` into `dist/`; they provide the SPA fallback, legacy-URL handling and security headers (CSP, `frame-ancestors`, `nosniff`, `Referrer-Policy`, …).
- The `justools-csp` Vite plugin injects a matching `<meta http-equiv="Content-Security-Policy">` into the production `index.html`. **Keep its host list in sync with `public/_headers`.**
- Fonts are self-hosted under `public/assets/fonts/` and loaded via `public/assets/css/fonts.css`.
- Analytics: `public/assets/js/analytics.js` is a GA4 placeholder that does nothing unless the deploy workflow writes a measurement ID into it.
- A static-only host will not have the demo function. The app still works with BYO keys; choose a BYO provider in **AI settings**, or remove the demo option if you deploy without the function.
