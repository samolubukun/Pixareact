import { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'crypto';
import { imageDescriptions } from '@/lib/image-store';

export async function POST(req: Request) {
	// Expect a multipart/form-data POST with a file field named "file".
	const contentType = req.headers.get('content-type') || '';
	if (!contentType.includes('multipart/form-data')) {
		return new Response('Expected multipart/form-data', { status: 400 });
	}

	const formData = await req.formData();
	const file = formData.get('file') as File | null;
	if (!file) return new Response('No file provided', { status: 400 });

		try {
			const buffer = Buffer.from(await file.arrayBuffer());
			const mime = file.type || 'application/octet-stream';
			const base64 = buffer.toString('base64');
			const dataUrl = `data:${mime};base64,${base64}`;

			// If GEMINI_API_KEY is set, forward the image bytes to Gemini Flash
			// via the official SDK to get a vivid, concise description that will
			// later be used to generate code. We never return this text to the
			// client; it's stored server-side and referenced by imageId.
			const geminiKey = process.env.GEMINI_API_KEY;
			let geminiText: string | undefined;

			if (geminiKey) {
				try {
					const ai = new GoogleGenAI({ apiKey: geminiKey });
					const prompt = `Provide a vivid, highly descriptive, and concise description of the uploaded image. Mention objects, layout, colors, textures, readable text, positions, and any notable visual details. Keep it factual and suitable to drive UI reconstruction code generation.`;

					// The SDK expects parts with inline/file data. Use inlineData with base64 bytes.
					const contents: any[] = [prompt, { inlineData: { data: base64, mimeType: mime } }];
					const mName = 'models/gemini-2.5-flash';
					const r = await ai.models.generateContent({ model: mName, contents });
					const candidateText = r?.text ?? r?.candidates?.[0]?.content ?? r;
					geminiText = String(candidateText ?? '');
				} catch (err) {
					console.warn('Gemini SDK error:', err);
				}
			}

			// Create an id for the image and store dataUrl + description server-side
			const id = randomUUID();
			imageDescriptions.set(id, { dataUrl, description: geminiText, name: file.name });

			// Return the data URL and imageId. Also include the generated (server-side)
			// Gemini description so the client can keep it in memory and forward it
			// back to the generate endpoint (we still don't display it in the UI).
			return new Response(
				JSON.stringify({ url: dataUrl, name: file.name, imageId: id, description: geminiText }),
				{
					headers: { 'Content-Type': 'application/json' },
				}
			);
		} catch (err) {
			console.error(err);
			return new Response('Failed to process file', { status: 500 });
		}
}
