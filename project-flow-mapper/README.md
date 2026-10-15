# Project Flow Mapper

Open a whole code project folder (or a `.zip` of it) and understand it in one place:

- **Overview**: what the project is, its tech stack, a language breakdown, how to run it (commands from `package.json`, the Makefile and the README), the environment variables the code reads, and its READMEs, entry points, manifests, docs, CI/CD and tests.
- **Flows** (opens first): every way the project starts, traced through the real code from start to end, including:
  - start-up (`npm start → src/server.js`) and scripts (`npm run migrate`);
  - every HTTP route (Express-style, Flask/FastAPI decorators, Go `HandleFunc`/Gin);
  - Next.js pages and API routes (`pages/` and `app/`), NestJS controllers, Django `urls.py`, Spring, ASP.NET and Laravel routes;
  - `package.json` `main`/`bin`/`exports` (mapped from `dist/` back to `src/`), Vite/CRA front-end entries, `main()` in any language, Python `__main__` blocks, `pyproject.toml` scripts and jobs;
  - a library's public API methods (ranked by what the docs mention), and **Other starting points**: functions that nothing else calls.

  Path aliases from `tsconfig.json`/`jsconfig.json` (`@/…`), workspace packages and re-exports are followed. If nothing is found, the tab says how many files and functions it read and offers two fallbacks: **Trace from…** (start a trace at any file or `file#function`, saved with the project) and **Ask AI to find the entry points**.

  **Everything, start to end** chains them all into one diagram. Each flow has three views:
  - **High level** (default): the flow grouped into a few big parts (components, folders or files), from where it starts, through the code, to where the data goes (Database, files, outside services), and back to the caller. A strip on top sums it up as Starts → Runs through → Data goes to → Ends. Click a part to see its files and the functions it runs.
  - **Play data flow**: an animated dot carries the data along each step, labelled with the values passed on that line (for example `parsed.data`). A caption says what happens ("Ticket routes calls Classifier: classify() with parsed.data"), the code for each step opens in the side panel, and stores flash when data is written or read. Pause, Restart, 0.5×–4× speed, **Play from here** on any part, and Space to play or pause. **Live dots** keeps small dots moving on every connection.
  - **Detailed** and **Call tree**: every call, in order, as described below. Play works in these views too.

  The **Detailed** view is a sequence diagram:
  - one column per file, plus columns for what it reaches outside the project (Database, HTTP / external API, File system, Configuration, Response to caller, Queue, Cloud, AI API);
  - numbered arrows for each call in order, with the condition that guards it (for example `if (priority === "P1")` or `for each file in …`).

  Click a step to see the calling line and the target function with code, or walk through with ← →. Switch to **Call tree** for an indented list, ask the AI to explain the flow, or save it as an image.
- **Architecture**: a **Files** view (default) showing which files call which, with call counts, and a **Components** view grouped by responsibility. Clicking a file lists its functions, what each one calls and what calls it, plus every flow the file appears in.
- **Architecture (components)**: the project's components and which ones use which, laid out top to bottom. Arrows come from real imports (JavaScript/TypeScript, Python, Go, Java/Kotlin, Rust, C/C++, Ruby, PHP, HTML/CSS) plus the AI's reading of the code. Click a component for details; double-click to open its main file.
- **Structure**: the full file tree with line counts and labels for README, entry, manifest, test, CI, edited, notes and TODO. Click a file for its imports and importers, or open it.
- **How it runs**: the AI's plain-language version of the end-to-end flow, built from the call traces above (setup, start-up, then the main runtime path) as a diagram with decisions, loops, and branches the code doesn't handle.
- **Mind map**: the project, its components and key files, plus the run flow. Dependency links are drawn automatically, and you can add your own.
- **Suggestions**: gaps such as no tests or CI, missing `.env.example`, a README that mentions files that don't exist, undocumented scripts, components without docs, circular dependencies, TODOs, very large files, and unhandled branches. An AI review is also available, and each item has a one-click fix.
- **Source**: open any file. Markdown is shown formatted with a contents list; code is shown with line numbers and a symbol outline. Lines changed since import are highlighted.
- **Read with me**: have any file explained aloud, section by section, and ask questions as you go (typed, or spoken in Chrome and Edge).
- **Notes**: select lines in any file and attach a Fix, Change, Question or Note. Notes can be fixed by the AI, saved into the file as comments, or exported for later.
- **Chat with AI**: about the whole project, a component, a file or a step. Asked-for fixes are written into the files, and the AI can create new files too. Every change is tracked in **Changes**, with Undo, a compare-with-original view and a change log.
- **Save**: after a fix, the chat reply and each entry in **Changes** have buttons to download each changed file or the whole project. **Download project (.zip)** in the header saves every loaded file, with your edits, plus a change log and a `NOT_INCLUDED.txt` listing files that weren't loaded (binaries, lock files). You can also download only the changed files, or save the architecture, a flow, the run flow or mind map as PNG or JPEG.

Everything runs in the browser. The project's files are read locally and kept in this browser's IndexedDB, so reopening the page restores the last project. Nothing is uploaded anywhere except the text sent to the AI provider you choose.

## How the call tracing works

The tracer reads the code in the browser. It works from function and class definitions, imports and `require`s (including destructured and aliased ones), `this`/`self` methods, module start-up code, route registrations and mounts, and calls on known libraries, which it labels by type (for example `pg` → Database, `fetch`/`axios`/`requests` → HTTP, `fs` → File system).

It's static and pattern-based, not a full compiler. Dynamic dispatch, dependency injection, reflection and callbacks passed through variables can be missed, and a variable with the same name as a function can occasionally be mistaken for it. JavaScript/TypeScript, Python and Go get the most detail; other languages get function outlines and best-effort calls. Mapping with AI uses these traces as the basis for the "How it runs" story.

## What gets read

- Skipped folders: `node_modules`, `.git`, `dist`, `build`, `out`, `.next`, `target`, `vendor`, virtual environments, caches and coverage.
- Lock files and binary files are listed in the tree but not loaded.
- Limits: up to 1,500 text files, 250 KB per file and about 14 MB of text in total; anything beyond that is listed but not loaded.
- AI requests include the file tree, READMEs, manifests, entry points and docs, plus the file or component you're focused on, trimmed to fit the model's input.

## Files

```
index.html                       the app
vendor/jszip.min.js              JSZip 3.10.1 (zip import and export)
vendor/JSZIP-LICENSE.md          JSZip license (MIT / GPLv3 dual)
vendor/html-to-image.js          html-to-image 1.11.13 (PNG/JPEG export)
vendor/HTML-TO-IMAGE-LICENSE.md  html-to-image license (MIT)
.nojekyll                        tells GitHub Pages to serve files as-is
```

## Run locally

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Folder picking works in Chrome, Edge, Firefox and Safari. You can also drag a folder onto the page in Chrome and Edge.

## Deploy (all free)

- **GitHub Pages:** put these files at the repository root, then go to **Settings → Pages → Deploy from a branch** and choose `main` and `/ (root)`.
- **Netlify:** drag the folder onto <https://app.netlify.com/drop>, then claim the project so it stays online.
- **Cloudflare Pages or Vercel:** connect the repository with no build command and the root folder as the output directory.

## AI features: bring your own key

Under **AI settings**, choose Anthropic (Claude), OpenAI (ChatGPT) or Google Gemini and paste your own key. **Test key** lists the models that key can use.

- The browser calls the provider directly. The page's Content Security Policy only allows connections to `api.anthropic.com`, `api.openai.com`, `generativelanguage.googleapis.com` and Google Fonts.
- Keys are kept for the current tab, or in this browser's local storage if you tick **Remember**.
- Usage is billed to the key owner. Set a spend limit. Mapping a large project sends a sizeable request, which uses more tokens than a single file.
- Without a key, the Overview, Architecture (from imports), Structure, Suggestions (quick checks), Source, Notes and downloads all work offline.
- Natural voices for **Read with me**: OpenAI (`gpt-4o-mini-tts`; Coral, Nova, Shimmer) or Gemini (`gemini-3.8-flash-tts`; Kore and others) use that provider's key. The browser's own voices are free.

### Security notes

- Project files and keys stay in the browser. Code text is sent only to the AI provider you choose, and only when you use an AI feature. Don't map confidential code with a provider whose terms you haven't approved; some free tiers may use prompts for training.
- Anyone who can run JavaScript on the page could read a stored key. Host it only on a domain you control and don't add third-party scripts.

## License

Choose a license for your repository. JSZip (MIT/GPLv3) and html-to-image (MIT) are included under their own licenses.
