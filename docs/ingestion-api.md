# Module 2: document ingestion API

`POST /api/ingest` accepts a multipart form with exactly one `file` and an optional JSON string named `options`. No upload UI is included in this module; the split-screen workspace and coach are Module 3.

## Configuration

Copy `.env.example` to `.env.local`, add a Google AI Studio key, and restart the server:

```dotenv
GOOGLE_GENERATIVE_AI_API_KEY=your-api-key-here
GEMINI_MODEL=gemini-3.8-flash
```

The model is configurable. The default model ID was checked against Google's model documentation and the live model catalog during implementation. API keys stay on the server and must not use a `NEXT_PUBLIC_` prefix.

The implementation uses `generateObject` from the installed AI SDK 5 and the direct Google provider. It requests structured JSON and then independently validates the result. No gateway credentials are required.

## Options

| Field           | Allowed values               | Default    |
| --------------- | ---------------------------- | ---------- |
| `operation`     | `preview`, `generate`        | `generate` |
| `mode`          | `exact`, `variants`          | `variants` |
| `questionCount` | Integer, 1–30                | 10         |
| `language`      | `en`, `vi`                   | `en`       |
| `focus`         | Text, up to 1,000 characters | Empty      |

`exact` preserves existing question and option wording, even if the requested explanation language differs. The server verifies that wording occurs in the source. `variants` creates source-based questions and alternate scenarios. Both modes return the required `conceptVariant` on every question. A narrow focus or small document can return fewer questions with a warning; unsupported questions are never added just to meet the count.

## Try preview without an API key

From the project directory, using Windows PowerShell:

```powershell
curl.exe -sS http://localhost:3000/api/ingest `
  -F 'file=@tests/fixtures/economics.txt' `
  -F 'options=<tests/fixtures/preview-options.json;type=application/json'
```

Preview returns `ok`, a `requestId`, `operation: "preview"`, and `document`:

```json
{
  "fileName": "economics.txt",
  "format": "txt",
  "sources": [
    {
      "id": "lines-1-16",
      "label": "Lines 1–16",
      "text": "Extracted source text…"
    }
  ],
  "characterCount": 780,
  "pageCount": null,
  "warnings": []
}
```

The example values are illustrative. Preview sends nothing to an AI provider and does not estimate a detected question count. The actual generated count is `pack.questions.length`.

## Generate a playable study pack

After configuring the key:

```powershell
curl.exe -sS http://localhost:3000/api/ingest `
  -F 'file=@tests/fixtures/economics.txt' `
  -F 'options=<tests/fixtures/generate-options.json;type=application/json'
```

The response contains:

- `document`: the parsed text and source locations.
- `pack`: a `StudyPack` compatible with `<SoloEngine pack={pack} />`.
- `sourceKind`: `testbank`, `lecture`, or `mixed` (AI classification).
- `references`: one source ID, label, and supporting excerpt per question ID.
- `warnings`: generation limitations, including requested-count shortfalls.
- `usage`: provider-reported input, output, and total tokens; unavailable counts are `null`.
- `requestId`: also present in the `X-Request-ID` header.

Questions keep the exact `QuestionItem` contract. Citation details remain outside that schema, in `pack.metadata` and `references`. IDs are assigned by the server. PDF citations use actual page numbers. DOCX citations use extracted paragraph numbers because text extraction cannot preserve Word's rendered pagination. TXT citations use line ranges.

Each quoted excerpt must occur in its cited source block after Unicode and whitespace normalization. This proves the excerpt exists; it does not independently prove the AI's answer or reasoning is correct. Review generated study material before relying on it.

## Limits and failures

- Maximum file: 5 MiB; streamed multipart body: 5 MiB + 64 KiB.
- Maximum PDF: 150 pages; extracted text: 120,000 characters. Oversized input is rejected, not silently truncated.
- DOCX: up to 1,000 ZIP entries and 20 MiB advertised uncompressed content. Encrypted, multi-volume, and ZIP64 archives are unsupported.
- TXT: UTF-8, including Vietnamese. Binary or other encodings are rejected.
- Scanned/image-only PDFs require OCR before upload. Images, diagram interpretation, and PPTX are outside this module.
- The request deadline is 90 seconds, including upload and generation. Cancellation reaches the AI call and stops parsing between PDF pages. Synchronous parser work is not forcibly terminated mid-operation; this is not a hardened untrusted-file sandbox.
- Two simultaneous ingestion requests per server process. This is a local concurrency guard, not a distributed rate limit or authentication system.

Errors use `{ "ok": false, "requestId": "…", "error": { "code": "…", "message": "…" } }`.

| HTTP status | Examples                                                   |
| ----------- | ---------------------------------------------------------- |
| 400         | Invalid options, missing file, malformed multipart         |
| 403         | Cross-origin browser upload                                |
| 413         | File, body, page, or extracted-text limit exceeded         |
| 415         | Unsupported file or MIME mismatch                          |
| 422         | Corrupt document, OCR needed, insufficient source material |
| 429         | Local capacity or provider quota reached                   |
| 499         | Client cancelled the request                               |
| 502         | Invalid AI structure/citation or provider failure          |
| 503         | Missing or rejected server credentials                     |
| 504         | Processing deadline exceeded                               |

Files are processed in memory and not saved to disk, Supabase, or logs. Generation sends extracted text and focus settings to Google. All responses have `Cache-Control: no-store`. Raw provider errors are never sent to the client. Public deployment should add authentication, per-user quotas, and isolated parsing workers before exposing paid generation broadly.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm start
# In another terminal:
npm run test:e2e
```

Tests exercise actual PDF/DOCX parsing, Unicode text, invalid and oversized input, aborts, request limits, SDK structured-output validation with an in-memory model, invalid citations, exact-mode preservation, safe errors, and live HTTP uploads. Live Gemini generation is a separate check requiring your key; mock-model tests do not verify account access or the selected model's live output quality.
