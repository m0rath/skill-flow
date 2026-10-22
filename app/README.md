# justools — app

The React + TypeScript single-page app behind **justools**: visual tools for AI agent skills, workflows and software codebases.

It ships two tools:

- **Skill Flow Mapper** (`/skill-flow`) — map, question and fix a Claude skill or Markdown playbook.
- **Project Flow Mapper** (`/project-flow`) — open a whole project folder, see its architecture and flows, then question and fix it.

> The original vanilla-JS app lives in the repository root `public/` and is kept as a read-only reference. This package (`app/`) is the port.

## Stack

Vite 8 · React 19 · TypeScript 5.9 · React Router 7 · Zustand 5 · `motion` · `jszip` · `html-to-image`.

## Prerequisites

- Node.js **>= 20** (`engines.node`).
- npm (bundled with Node). No package manager pin beyond the committed `package-lock.json`.

No environment variables or build-time secrets are required — see [Configuration](#configuration).

## Scripts

Run all commands from `app/`.

| Script                 | What it does                                        |
| ---------------------- | --------------------------------------------------- |
| `npm run dev`          | Start the Vite dev server on http://localhost:5173. |
| `npm run build`        | Type-check (`tsc -b`) then build to `dist/`.        |
| `npm run preview`      | Serve the production build locally (port 4173).     |
| `npm run typecheck`    | `tsc -b --noEmit`.                                  |
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
  vite.config.ts        # plugins (React, production CSP), vendor chunk splitting
  src/
    main.tsx            # entry: mounts <ErrorBoundary><App/></ErrorBoundary>
    App.tsx             # router, lazy routes, theme + AI-store bootstrap
    components/         # AppShell, Header, ErrorBoundary, icons, toaster, modals
    features/           # hub, skill-flow, project-flow views
    store/              # Zustand stores (app theme/toasts, AI settings, tools)
    ai/ model/ lib/     # provider clients, analysis model, helpers
    styles/             # legacy.css (tokens/design system) + app.css
  public/               # static assets, _headers, _redirects, fonts, favicon
```

Design tokens (`--paper`, `--surface`, `--ink`, `--muted`, `--line`, `--step`, …) live in `src/styles/legacy.css` and drive both light and dark themes.

## Configuration

The app runs entirely client-side. AI provider keys and model choices are entered by the user at runtime and stored in the browser only:

- `skillflow:theme` (localStorage) — light/dark preference.
- `skillflow:ai` (localStorage) / `skillflow:keys` (sessionStorage) — provider, model and API keys.

Keys are never bundled or committed. The Content-Security-Policy in `vite.config.ts`/`public/_headers` allowlists the provider API hosts.

## Deployment

`npm run build` emits a static SPA into `dist/`. CI (`.github/workflows/ci.yml`) checks both the legacy reference app and this package; `.github/workflows/deploy-netlify.yml` builds `app/` and publishes `app/dist/` to Netlify on every push to `main`, after the checks pass.

For any other static host, publish `dist/` with a single-page fallback to `index.html`:

- Vite copies `public/_redirects` and `public/_headers` into `dist/`; they provide the SPA fallback, legacy-URL handling and security headers (CSP, `frame-ancestors`, `nosniff`, `Referrer-Policy`, …).
- The `justools-csp` Vite plugin injects a matching `<meta http-equiv="Content-Security-Policy">` into the production `index.html`. **Keep its host list in sync with `public/_headers`.**
- Fonts are self-hosted under `public/assets/fonts/` and loaded via `public/assets/css/fonts.css`.
- Analytics: `public/assets/js/analytics.js` is a GA4 placeholder that does nothing unless the deploy workflow writes a measurement ID into it.
