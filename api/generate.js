// /api/generate.js (patched)
// - Always returns JSON (adds CORS + try/catch JSON errors)
// - Uses Next bodyParser with sizeLimit to accept JSON + small data URLs
// - Guards for missing envs and oversized images
// - Simpler JSON parsing from model output (no strict json_object mode)

import OpenAI from 'openai';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '6mb', // allow image dataURLs up to ~5-6MB
    },
  },
};

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(p => {
    const [k, ...v] = p.trim().split('=');
    if (!k) return;
    out[k] = decodeURIComponent(v.join('='));
  });
  return out;
}

async function ensureUserAndCredits({ url, key }, anonId) {
  // find/create user
  let r = await fetch(`${url}/rest/v1/users?anon_id=eq.${encodeURIComponent(anonId)}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
  const rows = await r.json();
  let user = rows[0];
  if (!user) {
    r = await fetch(`${url}/rest/v1/users`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify([{ anon_id: anonId }]),
    });
    const created = await r.json();
    user = created[0];
    await fetch(`${url}/rest/v1/usage_credits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ user_id: user.id, remaining: 20 }]),
    });
  }
  // read credits
  r = await fetch(`${url}/rest/v1/usage_credits?user_id=eq.${user.id}`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
  const credit = (await r.json())[0] || { remaining: 0 };
  return { user, remaining: credit.remaining };
}

async function decrementCredits({ url, key }, userId, remainingAfter) {
  await fetch(`${url}/rest/v1/usage_credits?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ remaining: Math.max(0, remainingAfter), updated_at: new Date().toISOString() }),
  });
}

export default async function handler(req, res) {
  // --- CORS (match early-access route policy) ---
  const ORIGIN = 'https://postengineai.com';
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });
    }
    const supa = {
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
    };
    if (!supa.url || !supa.key) return res.status(500).json({ error: 'Supabase env missing' });

    // Body is already parsed by Next (JSON)
    const body = req.body || {};
    const prompt = String(body.prompt || '').slice(0, 400);
    const imageDataUrl = String(body.imageDataUrl || '');
    // Soft guard: oversized data URL
    if (imageDataUrl && imageDataUrl.length > 5_000_000) {
      return res.status(413).json({ error: 'Image too large (max ~5MB data URL). Please upload a smaller image.' });
    }
    if (!prompt && !imageDataUrl) {
      return res.status(400).json({ error: 'Prompt or image required' });
    }

    // identify anon
    const cookies = parseCookies(req);
    const anon = cookies['pe_anon'] || null;
    if (!anon) return res.status(400).json({ error: 'Missing anon cookie' });

    const { user, remaining } = await ensureUserAndCredits(supa, anon);

    // paywall check (each call consumes 4 credits)
    const COST = 4;
    if (!user.is_pro && remaining < COST) {
      return res.status(402).json({
        error: 'credits_exhausted',
        message: 'Free credits are used up. Upgrade to continue.',
        remaining,
      });
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const messages = [
      { role: 'system', content: [
        "You are PostEngineAI, an assistant that writes short, catchy social captions.",
        "Requirements:",
        "- Return a JSON array of 6 distinct caption strings.",
        "- Keep each caption under 180 characters when possible.",
        "- Vary styles: punchy, playful, motivational, educational, call-to-action.",
        "- Include relevant emojis sparingly; do not overuse hashtags (0–4).",
        "- If an image is provided, match the caption to the image content.",
        "- Never include quotes or code fences around the JSON."
      ].join('\n') },
    ];

    const content = [];
    if (prompt) content.push({ type: 'text', text: `Create Instagram-style captions for: ${prompt}` });
    if (imageDataUrl) content.push({ type: 'image_url', image_url: { url: imageDataUrl } });
    messages.push({ role: 'user', content });

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.8,
      messages,
    });

    let text = completion.choices?.[0]?.message?.content || '[]';
    // Attempt to parse captions as an array
    let captions = [];
    try {
      captions = JSON.parse(text);
    } catch {
      const m = text.match(/\[[\s\S]*\]/); // extract best-effort JSON array
      if (m) { try { captions = JSON.parse(m[0]); } catch {} }
    }
    if (!Array.isArray(captions)) captions = [];
    captions = captions.map(s => String(s)).filter(Boolean).slice(0, 6);
    if (!captions.length) captions = ["Couldn't parse captions. Please try again."];

    // decrement credits if not pro
    let newRemaining = remaining;
    if (!user.is_pro) {
      newRemaining = Math.max(0, remaining - COST);
      await decrementCredits(supa, user.id, newRemaining);
    }

    return res.status(200).json({ ok: true, captions, remaining: user.is_pro ? null : newRemaining, isPro: !!user.is_pro });
  } catch (e) {
    console.error('generate error:', e);
    return res.status(500).json({ error: 'Server error', detail: String(e?.message || e) });
  }
}
