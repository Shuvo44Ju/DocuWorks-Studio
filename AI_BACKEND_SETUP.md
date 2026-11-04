# DocuWorks Studio — Free URS to CS AI backend

The converter uses Cloudflare Workers AI. It does not use the Anthropic API and does not require an Anthropic API key or paid Anthropic credits.

## How it works

- PDF pages are rendered to JPEG images in the browser using PDF.js, so visual tables and scanned pages are available to the vision model.
- DOCX files are converted to table-preserving HTML in the browser.
- The Cloudflare Worker calls `@cf/qwen/qwen3.8-27b` through the Workers AI binding.
- The AI returns requirement/specification pairs and source-review flags. The existing `CS.xlsx` template is then filled in the browser.

## Free usage

Cloudflare Workers AI currently includes a free allocation of 10,000 neurons per day. This is a shared daily allowance, not unlimited usage. It resets at 00:00 UTC. When the allowance is exhausted, the converter will report that the quota has been used and you can retry after it resets. Some models require paid access; the selected Qwen model is not among the models identified by Cloudflare as paid-plan-only in the current model catalogue.

The model is listed with vision support and zero data retention by Cloudflare. Output quality can differ from Claude Sonnet, so check the generated workbook against the original URS before official use. Low-confidence or uncertain rows should be reviewed.

## Cloudflare deployment

This repository uses Workers Static Assets plus a Worker API handler. The root `wrangler.jsonc` includes:

- Worker name: `docuworks-studio`
- Static assets binding: `ASSETS`
- Workers AI binding: `AI`

Deploy the latest repository version from the Cloudflare Worker deployment setup. The Wrangler config binds Workers AI as `env.AI`; no API key or secret needs to be created for this model.

## Verify the service

Open:

`https://docuworks-studio.shuvokh97.workers.dev/api/convert`

A correctly deployed Worker should return:

- `configured: true`
- `model: "@cf/qwen/qwen3.8-27b"`
- `diagnostic.workersAIBindingPresent: true`

If the binding is false or absent, deploy the latest commit with the `ai` binding in `wrangler.jsonc`.

## Use the converter

Open `https://shuvo44ju.github.io/DocuWorks-Studio/cs.html`, press Ctrl+F5, and upload a PDF or DOCX. PDF uploads are currently limited to 30 pages per file. The service sends document content to Cloudflare Workers AI for processing; do not upload documents unless your organisation permits that processing.

## Billing and privacy notes

- No Anthropic API credits are used by this backend.
- Free Workers AI usage is limited to 10,000 neurons per day; exceeding the limit stops further model requests until the daily reset.
- The selected model is marked as zero data retention in Cloudflare's model catalogue. Review current Cloudflare and model-provider terms for your organisation's requirements.
- The old `ANTHROPIC_API_KEY` secret is no longer used and may be removed from the Worker settings after the new AI binding is active.
