// api/early-access.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse JSON body (we'll send JSON from the form script)
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');

    const { name = '', email = '', niche = '', handle = '', source = 'Landing Page' } = body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    const table = process.env.SUPABASE_TABLE || 'signups';

    // Insert via Supabase REST (PostgREST)
    const r = await fetch(`${url}/rest/v1/${encodeURIComponent(table)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'apikey': key,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify([{ name, email, niche, handle, source }])
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(500).json({ error: 'Supabase insert failed', detail: text });
    }

    const data = await r.json();
    return res.status(200).json({ ok: true, record: data?.[0] || null });
  } catch (e) {
    return res.status(500).json({ error: 'Server error', detail: String(e) });
  }
}