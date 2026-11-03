# DocuWorks Studio - AI-powered URS to CS setup

This equipment-agnostic backend sends the uploaded document to Claude's document-understanding API, receives schema-validated extraction, and lets the existing ExcelJS/CSBuilder code populate the original CS.xlsx template. It contains no example requirements for any particular machine.

## Deploy once with Cloudflare Pages

1. In Cloudflare, create a Pages project connected to GitHub repository Shuvo44Ju/DocuWorks-Studio.
2. Choose the no-framework/static deployment configuration. Set build command blank and output directory to the repository root (often entered as / or . depending on the dashboard). The functions/api/convert.js file is the Pages Function.
3. In Settings > Variables and Secrets, add the encrypted secret ANTHROPIC_API_KEY using an API key from Anthropic. Never put this key in cs.html, ai-config.js, or another public repository file.
4. Optional: set ANTHROPIC_MODEL to a supported Claude model ID. Default: claude-sonnet-5.
5. Deploy. The endpoint is https://YOUR-PAGES-DOMAIN.pages.dev/api/convert; GET is a health check.
6. Before exposing a paid AI endpoint publicly, add a Cloudflare WAF rate-limiting rule for /api/convert and monitor provider usage. CORS is not authentication and does not stop direct HTTP clients.
7. Open the Pages URL and test with URS_456.pdf. The frontend uses /api/convert automatically on a .pages.dev hostname.

## Keep GitHub Pages as the visible URL (optional)

If the frontend must remain on GitHub Pages, set window.DOCUWORKS_AI_ENDPOINT in ai-config.js to the full Pages Function URL, e.g. https://YOUR-PAGES-DOMAIN.pages.dev/api/convert. This is a public endpoint URL, not a secret. The backend allows the GitHub Pages origin.

## Behavior

- PDF is sent as a PDF document block so Claude can use page visuals and extracted text.
- DOCX is converted to table-preserving HTML in the browser and interpreted by Claude.
- The API returns metadata, ordered sections, requirement/specification pairs, source pages, a short source excerpt, confidence, and review flags.
- Existing CS.xlsx is used in the browser; vendor compliance and vendor remarks stay blank.
- Unreadable or ambiguous items are flagged rather than guessed.

## Privacy and cost

The uploaded document is sent to this backend and then to the configured AI provider. This is different from the old local-only OCR flow. API usage may incur charges. Configure billing limits and rate limiting before routine use.
