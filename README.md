<a href="https://www.pixareact.com">
  <img alt="Pixareact" src="./public/og-image.png">
  <h1 align="center">Pixareact</h1>
</a>

Pixareact converts screenshots, wireframes, and sketches into working React + Tailwind TypeScript apps using a multimodal AI backend.

## Quick start

Requirements

- Node.js 18+
- A Gemini API key (set `GEMINI_API_KEY` in your environment)

Install and run locally:

```bash
npm install
npm run dev
```

Open http://localhost:3000 and try uploading a screenshot or the sample image.

## Environment

- `GEMINI_API_KEY` — required to call the Gemini model from server routes.

## Key files

- `app/page.tsx` — client UI for uploading images and streaming generated code.
- `app/layout.tsx` — site layout and metadata.
- `app/api/s3-upload/route.ts` — upload endpoint that returns a data URL and short description.
- `app/api/generateCode/route.ts` — server route that calls Gemini with a single multimodal request and returns sanitized TypeScript/TSX.

## Notes

- Images are sent inline (base64) by default; client-side resizing reduces payload size for large images.
- The server sanitizes generated code and performs one automatic repair attempt when simple heuristics detect unbalanced syntax.

## License

MIT
