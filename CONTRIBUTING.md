# Contributing

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Setup

You need Node.js 20 or newer.

```bash
cd app
npm install
npm run dev        # http://localhost:5173
```

The app is a Vite + React single-page app. The demo AI proxy runs as a Netlify Function; Vite serves the same `/api/demo` route in development. To test demo calls locally, create `app/.env.local` from `app/.env.example` and add the server-side demo keys.

## Before you open a pull request

From `app/`:

```bash
npm run check      # typecheck + lint + format check + tests
npm run format     # auto-fix formatting
npm run build      # production build
```

Also try your change in a browser, in light and dark mode, and check the mobile layout.

## Code layout

See [Project structure](app/README.md#structure) and the root [README](README.md#project-structure). In short:

- `src/model/` and `src/lib/` are pure helpers. Put logic here when you can.
- `src/features/` holds the Skill Flow and Project Flow views and stores.
- `src/ai/` holds provider clients, prompts, edits and demo/BYO behavior.
- `netlify/functions/demo.mjs` is the hidden-key AI proxy and rate limiter.

## Guidelines

- Keep provider keys out of source and client bundles. The demo keys belong in Netlify environment variables; BYO keys belong in the browser.
- Treat uploaded files and AI output as untrusted. Prefer React text rendering, or escape through `src/lib/util.ts`; do not evaluate content.
- If you add an external host, update the CSP in both `app/vite.config.ts` and `app/public/_headers`.
- Keep pull requests focused on one change.
