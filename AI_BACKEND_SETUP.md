# DocuWorks Studio - Claude-powered URS to CS

The app uses an equipment-agnostic Claude extraction API. No API key belongs in GitHub or browser JavaScript.

## Cloudflare Workers deployment

This repository is configured for Workers Static Assets plus a Worker API handler. It is not deployed as a Pages Functions project. The deploy command is:

\`npx wrangler deploy\`

The root \`wrangler.jsonc\` declares the Worker entry point, static assets binding, and routing so this command does not try to auto-detect/migrate a Pages Functions project.

### 1. Deploy from Cloudflare

Use the current Cloudflare build/deploy setup and keep the deploy command as \`npx wrangler deploy\`. Ensure the build environment checks out the latest main-branch commit with \`wrangler.jsonc\`, \`worker.js\`, and \`.assetsignore\`.

The Worker is named \`docuworks-studio\`. Cloudflare assigns its Workers URL under your account's workers.dev subdomain if workers.dev is enabled.

### 2. Add the API key securely

In Cloudflare Dashboard, open **Workers & Pages → docuworks-studio → Settings → Variables and Secrets → Add**. Create a secret named \`ANTHROPIC_API_KEY\` and paste the key into Cloudflare's secret-value field. Never put the value in GitHub, in \`cs.html\`, or in \`ai-config.js\`.

Optional: add \`ANTHROPIC_MODEL\` as a text variable to override the default model, \`claude-sonnet-5\`.

### 2A. Force-attach the secret to the live Worker (recommended if health says false)

From the repository root (the folder containing `wrangler.jsonc`), run:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

Wrangler will prompt for the secret value. Paste the Anthropic key into that prompt only; do not put it in the command, a source file, or GitHub. This command attaches the secret to the Worker selected by `wrangler.jsonc` (\`docuworks-studio\`) and deploys a new Worker version immediately. If Wrangler asks to authenticate, run `npx wrangler login` first and repeat the command.

The repository's Wrangler config now declares `ANTHROPIC_API_KEY` as required, so future Wrangler deployments validate that the secret exists rather than silently deploying without it.

### 3. Verify the service

Open \`https://YOUR-WORKER-URL/api/convert\`. The GET endpoint returns JSON with \`configured: true\` after the secret is available. A false value means the secret is missing or attached to another environment.

Upload the sample URS PDF at \`https://YOUR-WORKER-URL/cs.html\`. The app sends the PDF to Claude for full-document interpretation and uses the response to fill the existing \`CS.xlsx\` template. Vendor response columns remain blank. Ambiguous items are marked for source review.

### 4. Keep using the old GitHub Pages URL (optional)

If the user-facing website must remain at \`https://shuvo44ju.github.io/DocuWorks-Studio/cs.html\`, set \`window.DOCUWORKS_AI_ENDPOINT\` in \`ai-config.js\` to the deployed Worker's full API URL, such as \`https://YOUR-WORKER-URL/api/convert\`. This is an endpoint URL, not a secret. The endpoint explicitly allows the GitHub Pages origin. The configuration file is public, so do not add a key there.

### Privacy, usage, protection

Uploaded documents are sent to the Worker and then to Anthropic for AI processing; this is not local-only processing. API calls may incur charges. Set provider spending/usage limits and configure Cloudflare rate limiting before routine use. CORS is not authentication and does not prevent direct HTTP requests.
