# Security policy

## Reporting a vulnerability

Please don't open a public issue for security problems. Use GitHub's
[private vulnerability reporting](https://github.com/m0rath/skill-flow/security/advisories/new) instead.
You should get a reply within a week.

## What's in scope

Skill Flow Mapper runs entirely in the browser. The most important things to protect are:

- **API keys.** Users paste their own keys. Keys are only sent to the provider the user picked, and are kept in
  `sessionStorage` (or `localStorage` if the user opts in).
- **Uploaded files.** Skill files and AI replies are untrusted. They must always be escaped before rendering and
  never run as code.

Examples of in-scope issues: XSS through a crafted `SKILL.md`, zip or AI reply; a key leaking to any host other than the
chosen provider; ways around the Content Security Policy.

## Rules for contributors

- Don't add third-party scripts or analytics. Any script on the page could read stored keys.
- Escape all dynamic content with `esc()` (`public/assets/js/lib/util.js`) before putting it into HTML.
- A new network host must be added to `connect-src` in both `public/index.html` and `public/_headers`.
