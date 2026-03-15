// /api/generate.js
// Real caption generation with Anthropic Claude API + trial credits (20) + optional image input.
// Requires env: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY (or SERVICE_ROLE_KEY)

import Anthropic from '@anthropic-ai/sdk';

export const config = {
  api: {
    bodyParser: false, // we'll parse manually to support larger payloads / raw buffer
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

async function readJsonBody(req) {
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const raw = Buffer.concat(chunks).toString() || '{}';
  try { return JSON.parse(raw); } catch { return {}; }
}

function makeSystemPrompt() {
  return [
    "You are PostEngineAI, an expert at writing scroll-stopping social captions.",
    "Return a JSON object with:",
    "- \"captions\": array of 6 distinct captions. Each can be a string OR object with {hook, caption, onscreen_text}.",
    "- \"suggestedMood\": one of: calm, energetic, cinematic, vlog (for background music).",
    "Caption rules:",
    "- Keep each under 180 chars when possible. Vary styles: punchy, playful, motivational, educational, CTA.",
    "- Use emojis sparingly. Match content to any provided image or video frames.",
    "- For video: base captions ONLY on what is visible in frames. Do NOT invent scenes.",
    "- For objects: hook = attention-grabbing opener, caption = main text, onscreen_text = optional overlay suggestions.",
    "Return valid JSON only, no markdown fences."
  ].join("\\n");
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

async function decrementCredits({ url, key }, userId, used) {
  await fetch(`${url}/rest/v1/usage_credits?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ remaining: Math.max(0, used), updated_at: new Date().toISOString() }),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const supa = {
      url: process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
    };
    if (!supa.url || !supa.key) return res.status(500).json({ error: 'Supabase env missing' });

    const cookies = parseCookies(req);
    const anon = cookies['pe_anon'] || null;
    if (!anon) return res.status(400).json({ error: 'Missing anon cookie' });

    const { user, remaining } = await ensureUserAndCredits(supa, anon);

    // parse JSON: { prompt, imageDataUrl }
    const body = await readJsonBody(req);
    const prompt = (body.prompt || '').toString().slice(0, 400);
    const imageDataUrl = (body.imageDataUrl || '').toString();
    const mediaKind =
      body.contentType === 'video'
        ? 'video'
        : body.contentType === 'image'
        ? 'image'
        : 'text';
    const targetPlatforms = Array.isArray(body.platforms) && body.platforms.length
      ? body.platforms
      : ['instagram'];
    const videoDuration = body.videoMeta?.duration || null;
    const videoFrames = Array.isArray(body.videoFrames) ? body.videoFrames : [];
    // Allow prompt-only, image-only, or video-only
    if (!prompt && !imageDataUrl && mediaKind !== 'video' && mediaKind !== 'text') {
      return res.status(400).json({ error: 'Prompt, image, or video required' });
    }

    // paywall check (each call consumes 4 credits)
    const COST = 1;
    if (!user.is_pro && remaining < COST) {
      return res.status(402).json({
        error: 'credits_exhausted',
        message: 'Free credits are used up. Upgrade to continue.',
        remaining,
      });
    }

    // Rough location from hosting headers (Vercel)
const city = req.headers['x-vercel-ip-city'] || '';
const country = req.headers['x-vercel-ip-country'] || '';
const region = req.headers['x-vercel-ip-country-region'] || '';
const locationStr = [city, region, country].filter(Boolean).join(', ');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const systemPrompt = makeSystemPrompt() +
      `\nContent type: ${mediaKind}.` +
      `\nPlatforms: ${targetPlatforms.join(', ')}.` +
      `\nInclude hook, caption, hashtags, and onscreen_text.`;

    const content = [];
    const topicText = prompt
      ? `Topic: ${prompt}.`
      : 'No explicit topic provided. Generate captions based only on the media content.';

    content.push({
      type: 'text',
      text: `Create ${mediaKind} captions for ${targetPlatforms.join(', ')}. ${topicText} Video length: ${videoDuration || 'n/a'} seconds.`
    });

    // Convert data URLs to Claude's image format: { type, source: { type, media_type, data } }
    function toClaudeImage(dataUrl) {
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
      if (!m) return null;
      return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
    }

    if (imageDataUrl) {
      const img = toClaudeImage(imageDataUrl);
      if (img) content.push(img);
    }
    if (mediaKind === 'video' && videoFrames.length) {
      for (const f of videoFrames.slice(0, 8)) {
        const img = toClaudeImage(f);
        if (img) content.push(img);
      }
    }

    const completion = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
      max_tokens: 1024,
      temperature: mediaKind === 'video' ? 0.4 : 0.8,
      system: systemPrompt,
      messages: [{ role: 'user', content }],
    });

    let text = completion.content?.[0]?.type === 'text' ? completion.content[0].text : '[]';

    let suggestedMood = null;
    try {
      const parsedMood = JSON.parse(text);
      if (parsedMood && typeof parsedMood.suggestedMood === 'string') {
        suggestedMood = parsedMood.suggestedMood.toLowerCase();
      }
    } catch {}


// Generate hashtags via Claude (min 6)
const hashPrompt = [
  'You generate effective, non-spammy hashtags for Instagram/TikTok.',
  'Return JSON: {"hashtags": ["#tag1", "#tag2", ...]} with 12-20 items.',
  'Lowercase, no repeats, max 30 chars per tag, avoid banned/overly generic tags.',
  locationStr ? `Prioritize local discoverability around: ${locationStr}` : 'No explicit location available.',
].join('\n');
const hashMessages = [
  { role: 'system', content: hashPrompt },
  { role: 'user', content: JSON.stringify({ topic: prompt, location: locationStr||null }) }
];
const hashComp = await client.messages.create({
  model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
  max_tokens: 512,
  temperature: 0.6,
  system: hashMessages[0].content,
  messages: [hashMessages[1]],
});
let hashtags = [];
try {
  const parsedH = JSON.parse(hashComp.content?.[0]?.type === 'text' ? hashComp.content[0].text : '{}');
  if (Array.isArray(parsedH.hashtags)) hashtags = parsedH.hashtags.filter(Boolean);
} catch {}
if (hashtags.length < 6) {
  // simple fallback if model fails
  const base = (prompt||'').toLowerCase().replace(/[^a-z0-9\s]/g,'').trim().split(/\s+/).filter(Boolean).slice(0,5);
  hashtags = Array.from(new Set([
    ...base.map(w=>`#${w}`), '#reels', '#trending', '#creator',
    locationStr ? `#${locationStr.toLowerCase().replace(/[^a-z0-9]/g,'')}` : null
  ].filter(Boolean)));
}
    // Parse captions: support array of strings or objects {hook, caption, onscreen_text}
    let captions = [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) captions = parsed;
      else if (Array.isArray(parsed.captions)) captions = parsed.captions;
    } catch {
      const m = text.match(/\[[\s\S]*\]/);
      if (m) { try { captions = JSON.parse(m[0]); } catch {} }
    }
    captions = (captions || []).slice(0, 6).filter(Boolean).map(v => {
      if (typeof v === 'object' && v !== null && (v.hook || v.caption)) return v;
      const s = String(v || '').trim();
      return s.length > 10 ? s : null;
    }).filter(Boolean);
    if (!captions.length) captions = ["Couldn't parse captions. Please try again."];

    // decrement credits if not pro
    let newRemaining = remaining;
    if (!user.is_pro) {
      newRemaining = Math.max(0, remaining - COST);
      await decrementCredits(supa, user.id, newRemaining);
    }

    return res.status(200).json({
      ok: true,
      captions: {
        instagram: captions,
        whatsapp: captions.slice(0, 3),
        facebook: captions.slice(0, 3)
      },
      hashtags,
      suggestedMood,
      remaining: user.is_pro ? null : newRemaining,
      credits_left: user.is_pro ? null : newRemaining,
      isPro: !!user.is_pro,
      location: locationStr || null
    });
  } catch (e) {
    console.error('generate error:', e);
    return res.status(500).json({ error: 'Server error', detail: String(e) });
  }
}
