# Skill Flow Mapper

Upload a Claude skill (`SKILL.md`, or a zipped skill folder) or any Markdown playbook and see the whole workflow at once:

- **Diagram**: every step in order, decision points with one lane per outcome, loops, and the files each step creates. You can pan, zoom, collapse branches and step through with ← / →.
- **Mind map**: the skill name in the centre with its steps, branches and outputs around it. Links between steps that pass data are drawn automatically, and you can drag from a dot to add your own links.
- **Suggestions**: gaps such as "it says what to do if X exists, but not if it doesn't", missing failure handling, loops with no end and missing files. Each gap has a one-click fix.
- **Chat with AI** (Claude, ChatGPT or Gemini): ask about one step or the whole flow. When you ask for a fix, the AI edits the file and the diagram redraws. Undo is always available.
- **Download** the updated `.md`, or a `.zip` for multi-file skills.

The whole app is static: one `index.html` plus a vendored copy of JSZip. There is no build step and no server.

## Files

```
index.html              the app
vendor/jszip.min.js     JSZip 3.10.1 (reads and writes .zip skill folders)
vendor/JSZIP-LICENSE.md JSZip license (MIT / GPLv3 dual)
.nojekyll               tells GitHub Pages to serve files as-is
```

## Run locally

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy (all free)

### GitHub Pages

1. Create a repository and add these files at the root (or in `/docs`).
2. Go to **Settings → Pages → Build and deployment**, choose **Deploy from a branch**, then pick `main` and `/ (root)` (or `/docs`).
3. The site appears at `https://<user>.github.io/<repo>/` within a minute or two.

A private repository needs a paid plan to use Pages, unless your organization's plan includes it.

### Netlify

Drag the folder onto <https://app.netlify.com/drop>, or connect the repository with an empty build command and `.` as the publish directory.

### Cloudflare Pages

Create a project, connect the repository, leave the build command empty and set the output directory to `/`.

### Vercel

Import the repository and choose the **Other** framework preset, with no build command and `.` as the output directory.

## AI features: bring your own key

Chat, AI mapping and the gap review work with any of three providers. Each user picks one under **AI settings** in the app and adds their own key:

| Provider | Get a key | Free option |
|---|---|---|
| Anthropic (Claude) | [console.anthropic.com](https://console.anthropic.com/settings/keys) | No free tier; new accounts may get a small trial credit |
| OpenAI (ChatGPT) | [platform.openai.com](https://platform.openai.com/api-keys) | No; API usage is billed separately from ChatGPT Plus |
| Google Gemini | [aistudio.google.com](https://aistudio.google.com/app/apikey) | Yes, a rate-limited free tier (on it, Google may use prompts to improve its products) |

- **Where the key goes:** the browser calls the chosen provider directly (`api.anthropic.com`, `api.openai.com` or `generativelanguage.googleapis.com`). The key is never sent anywhere else. The page's Content Security Policy only allows network connections to those three hosts.
- **Where keys are kept:** by default only for the current tab (sessionStorage). If the user ticks **Remember keys on this device**, they're kept in this browser's localStorage. Each provider's key is stored separately, and **Remove this key** deletes one.
- **Models:** **Test key** lists the models the key can use, straight from the provider, so the list stays current. You can also type any model ID.
- **Quality:** turning a skill into a diagram needs a model that returns clean structured JSON. Larger models (Claude Sonnet or Opus, a full-size GPT model, Gemini Pro or Flash) do this well. Very small models may produce rougher diagrams and fixes.
- **Cost:** usage is billed to the key owner. Set a spend limit with your provider.
- **Without a key:** the diagram, mind map, quick checks, outline, source editing and download all work offline. They use a built-in parser that is less accurate than a model.

### Security notes for shared deployments

- Anyone who can run JavaScript on the page could read a key stored there. Host only on a domain you control, and don't add third-party scripts. Uploaded file content is always escaped, never run.
- For a team deployment where people shouldn't handle raw keys, put a small proxy (for example a Netlify Function or Cloudflare Worker) in front of the provider. The proxy holds the key and checks users, and the request URLs in `REQ` in `index.html` point at it. The app doesn't include a proxy.
- Check your organization's policy on API keys in browsers before sharing the link widely.

## Customizing

- The prompts are in `index.html`: search for `mapPrompt`, `chatInstructions` and `runSuggestions`. Provider request formats are in `REQ` and `listModels`.
- The colors are CSS variables at the top of the `<style>` block, with separate light and dark values.
- If you add another external host (for example a proxy or another provider), add it to the `connect-src` part of the Content-Security-Policy `<meta>` tag.

## License

Choose a license for your repository. JSZip is included under its own MIT/GPLv3 dual license (see `vendor/JSZIP-LICENSE.md`).
