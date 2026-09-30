# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

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
