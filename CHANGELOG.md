# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

React and TypeScript rewrite, now the only production implementation.

### Added

- **Project Flow Mapper**: open a project folder or `.zip`, inspect architecture, startup paths, routes and call flows, review suggestions and export the result.
- A hub landing page with routes for both tools, lazy-loaded pages and a shared app shell.
- **No-key demo AI** backed by a Netlify Function, with server-side provider keys and per-IP/global rate limits.
- **Gemini 3.5 Flash-Lite** as the default demo model, with **Mistral Small 4** selectable.
- **Mistral** as a bring-your-own-key provider alongside Anthropic, OpenAI and Gemini.
- Demo privacy banner and an AI settings note recommending a personal key for private code.
- Clear handling for demo limits, provider rate limits and unavailable demo models.
- Manual Netlify deploys (`workflow_dispatch`) labeled with `manual@<sha>`.

### Changed

- The site is built and deployed from `app/` to Netlify; the production artifact is `app/dist/`.
- CI now checks only the React app (typecheck, lint, formatting, tests and build).
- Demo provider rate limits show a model-specific message and suggest the other demo model or a personal key.

### Removed

- The legacy vanilla-JS app in `public/`.
- The legacy static Project Flow Mapper under `project-flow-mapper/`.
- Legacy root tests, static dev server and the root npm/ESLint/Prettier setup.

## [1.0.0] - 2026-09-29

First open-source release.

### Added

- Diagram, mind map, outline and source views for Claude skills and Markdown playbooks.
- Quick checks and an AI review that find gaps in the workflow.
- AI chat (Anthropic, OpenAI or Gemini, with your own key) that edits the file, with undo.
- **Changes** tab: the net diff against the uploaded file, with copy, `.patch` download and "Restore original".
- Automatic retries when the AI provider is overloaded or rate-limited.
- Export of the diagram and mind map as PNG or SVG images, and of the flow as Mermaid code.
- Upload of `.md` files and zipped skill folders; download as `.md` or `.zip`.
- A built-in example skill that walks through each feature.
- Light and dark themes (the choice is remembered).

### Security

- Strict Content Security Policy: no inline scripts, and network access only to the three AI providers (and to the site itself, so image exports can embed the fonts), plus Google Analytics hosts.
- Self-hosted fonts. The only third-party script is Google Analytics, which loads only when a measurement ID is set at deploy time.
- Size limits on uploads and on unzipped files, which guard against zip bombs.
