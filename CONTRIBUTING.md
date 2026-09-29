# Contributing

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Setup

You need Node.js 20 or newer. Node is only used for the dev server, linting and tests; the app itself has no build step.

```bash
npm install
npm start          # http://localhost:8000
```

ES modules don't load from `file://`, so open the app through `npm start` (or any static server) instead of
double-clicking `index.html`.

## Before you open a pull request

```bash
npm run check      # lint + format check + unit tests
npm run format     # auto-fix formatting
```

Also try your change in a browser, in light and dark mode.

## Code layout

See [Project structure](README.md#project-structure) in the README. In short:

- `model/` and `lib/` are pure functions with no DOM access. Put logic here when you can, and add a test in `tests/`.
- `ui/` renders views. `app/` handles files and undo. `ai/` talks to the providers.
- Modules have no side effects when imported. Each one exports an `init*()` function that `main.js` calls once.
- Shared state lives in `S` in `state.js`. Call `save()` after changing anything that should survive a reload.

## Guidelines

- Keep it dependency-free at runtime. JSZip is the only vendored library.
- Escape everything that comes from a file or an AI reply with `esc()`.
- No inline `<script>` or `on*=` attributes: the Content Security Policy blocks them.
- Keep pull requests focused on one change.
