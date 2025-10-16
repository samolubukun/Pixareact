export async function GET() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return new Response('GEMINI_API_KEY not configured', { status: 500 });

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(key)}`;
    const res = await fetch(endpoint, { method: 'GET' });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return new Response(`Models list request failed: ${res.status} ${body}`, { status: 502 });
    }
    const data = await res.json();
    // Return the raw models list to the caller for diagnostics.
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(String(err), { status: 500 });
  }
}

export const runtime = 'edge';
