// api/early-access.js
export default async function handler(req, res) {
  // --- CORS (adjust origin if you ever use a staging domain)
  const ORIGIN = 'https://postengineai.com';
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    // Parse JSON body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');

    // Honeypot field (add a hidden <input name="website"> on the form)
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      // Pretend success to bots; don't write anything.
      return res.status(200).json({ ok: true });
    }

    const { name = '', email = '', niche = '', handle = '', source = 'Landing Page' } = body;

    // Basic email validation
    const emailOk = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));
    if (!emailOk(email)) return res.status(400).json({ error: 'Invalid email' });

    // Capture IP + UA (useful for analytics / rate limits later)
    const ip =
      (req.headers['x-forwarded-for'] || '')
        .toString()
        .split(',')[0]
        .trim() || req.socket?.remoteAddress || null;
    const ua = (req.headers['user-agent'] || '').toString();

    // Env vars (service role key bypasses RLS; never expose client-side)
    const url = process.env.SUPABASE_URL;
    const key =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY; // keep backward compat with your current var
    const table = process.env.SUPABASE_TABLE || 'signups';

    if (!url || !key) {
      return res.status(500).json({ error: 'Supabase env not configured' });
    }

    // Upsert by email (requires unique index on email)
    // PostgREST upsert: POST + ?on_conflict=email + Prefer: resolution=merge-duplicates
    const endpoint = `${url}/rest/v1/${encodeURIComponent(table)}?on_conflict=email`;

    // Timeout helper
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000); // 10s

    const r = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': 'application/json',
        Prefer: 'return=representation,resolution=merge-duplicates'
      },
      body: JSON.stringify([{ name, email, niche, handle, source, ip, ua }])
    }).finally(() => clearTimeout(timeout));

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return res.status(502).json({ error: 'Supabase insert failed', detail });
    }

    const data = await r.json().catch(() => []);
    return res.status(200).json({ ok: true, record: data?.[0] || null });
  } catch (e) {
    // AbortError -> timeout
    if (e && e.name === 'AbortError') {
      return res.status(504).json({ error: 'Upstream timeout' });
    }
    return res.status(500).json({ error: 'Server error', detail: String(e) });
  }
}