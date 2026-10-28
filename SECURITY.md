# Security policy

## Reporting a vulnerability

Please don't open a public issue for security problems. Use GitHub's
[private vulnerability reporting](https://github.com/m0rath/skill-flow/security/advisories/new) instead.
You should get a reply within a week.

## What's in scope

justools has two ways to use AI:

- **Shared demo.** Provider keys live only in the Netlify Function environment. The browser calls the same-origin `/api/demo` route; the function adds the hidden key, enforces rate limits and streams the response.
- **Bring your own key.** Users paste their own key. It is kept in `sessionStorage` (or `localStorage` if the user opts in) and sent only to the provider they selected.

Uploaded files, project archives and AI replies are untrusted. They must be rendered as text or through the escaping helpers, never executed.

Examples of in-scope issues: XSS through a crafted `SKILL.md`, project file, zip or AI reply; a BYO key leaking to any host other than the chosen provider; a demo provider key reaching the browser; ways around the Content Security Policy.

## Rules for contributors

- Don't add third-party scripts. Any script on the page could read stored keys. The one exception is Google Analytics in `app/public/assets/js/analytics.js`, which only loads when the deploy sets a measurement ID.
- Prefer React text rendering; escape dynamic HTML through `esc()` (`app/src/lib/util.ts`).
- A new network host must be added to the CSP in both `app/vite.config.ts` and `app/public/_headers`.
- Never commit provider keys or put them in client-side code.
