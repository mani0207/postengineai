// api/early-access.js

// ---------- Mailjet (SMTP) transporter ----------
async function getTransporter() {
  const {
    SMTP_HOST, SMTP_PORT, SMTP_SECURE,
    SMTP_USER,
    SMTP_PASS,        // preferred env name
    SMTP_PASSWORD     // legacy env name (fallback)
  } = process.env;

  const pass = SMTP_PASS || SMTP_PASSWORD; // <- ALWAYS read from process.env
  if (!SMTP_HOST || !SMTP_USER || !pass) {
    console.error('SMTP env missing', { hasHost: !!SMTP_HOST, hasUser: !!SMTP_USER, hasPass: !!pass });
    return null;
  }

  const nodemailer = await import('nodemailer');
  const tx = nodemailer.createTransport({
    host: SMTP_HOST,                              // e.g., in-v3.mailjet.com
    port: Number(SMTP_PORT || 587),
    secure: String(SMTP_SECURE || 'false') === 'true',
    auth: { user: SMTP_USER, pass },
    // optional debug:
    // logger: true, debug: true
  });

  try { await tx.verify(); } catch (e) {
    console.error('SMTP verify failed:', e?.message || e);
  }
  return tx;
}
async function sendOwnerEmail({ name, email, niche, handle, source }) {
  try {
    const tx = await getTransporter(); if (!tx) return;
    const from = process.env.NOTIFY_FROM || process.env.SMTP_USER;
    const to = process.env.NOTIFY_TO || 'manisundar.92@gmail.com';
    await tx.sendMail({
      from, to,
      subject: `New signup — ${email} | 20 free captions unlocked`,
      html: `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;line-height:1.55;">
          <h2 style="margin:0 0 8px">New early-access signup</h2>
          <p style="margin:8px 0 0 0;"><strong>Email:</strong> ${email}</p>
          <p style="margin:4px 0 0 0;"><strong>Name:</strong> ${name || '-'}</p>
          <p style="margin:4px 0 0 0;"><strong>Niche:</strong> ${niche || '-'}</p>
          <p style="margin:4px 0 0 0;"><strong>Handle:</strong> ${handle || '-'}</p>
          <p style="margin:4px 0 0 0;"><strong>Source:</strong> ${source || '-'}</p>
          <p style="margin:12px 0 0 0; color:#0f172a"><em>Plan reminder:</em> $5/mo after trial.</p>
        </div>`
    });
  } catch (err) {
    console.error('Owner email failed:', err?.response || err);
  }
}

async function sendUserConfirmEmail({ name, email }) {
  try {
    const tx = await getTransporter(); if (!tx || !email) return;
    const from = process.env.NOTIFY_FROM || process.env.SMTP_USER; // MUST be verified
    const logoUrl = process.env.BRAND_LOGO_URL || 'https://postengineai.com/header-logo-tight.png';

    await tx.sendMail({
      from,
      to: email,
      subject: `Thanks for signing up — your 20 free captions are ready | postEngineAI`,
      html: `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;line-height:1.6;color:#0f172a;background:#0b1220;padding:24px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#0e141b;border-radius:16px;border:1px solid rgba(255,255,255,0.08);">
            <tr>
              <td style="padding:20px 24px 0 24px;text-align:center;">
                <img src="${logoUrl}" alt="postEngineAI" width="120" height="auto" style="max-width:140px;border:0;display:inline-block;" />
              </td>
            </tr>
            <tr>
              <td style="padding:8px 24px 0 24px;text-align:center;">
                <h1 style="margin:8px 0 0 0;font-size:20px;color:#ffffff;">Thanks for signing up${name ? `, ${name}` : ''}! 🎉</h1>
                <p style="margin:10px 0 0 0;color:#cbd5e1;">You’ve unlocked <strong>20 free caption generations</strong> to try postEngineAI.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px 0 24px;">
                <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:14px;">
                  <p style="margin:0 0 8px 0;color:#e2e8f0;">What you can do:</p>
                  <ul style="margin:0;padding-left:18px;color:#cbd5e1;">
                    <li>Generate 6 varied captions per click (playful, punchy, CTA, etc.).</li>
                    <li>Optional image upload to tailor captions to your media.</li>
                    <li>Auto-generated, location-aware hashtags.</li>
                  </ul>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px 0 24px;">
                <p style="margin:0;color:#cbd5e1;">Love it? Upgrade anytime for just <strong style="color:#fff;">$5/mo</strong> to keep the ideas flowing.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 24px 24px 24px;text-align:center;">
                <a href="https://postengineai.com/app.user.html" 
                   style="display:inline-block;background:#ffffff;color:#000000;font-weight:600;text-decoration:none;padding:10px 14px;border-radius:10px;">
                  Open postEngineAI
                </a>
                <p style="margin:12px 0 0 0;font-size:13px;color:#94a3b8;">Questions? Just reply to this email.</p>
                <p style="margin:8px 0 0 0;font-size:12px;color:#64748b;">— Team postEngineAI</p>
              </td>
            </tr>
          </table>
        </div>
      `
    });
  } catch (err) {
    console.error('User confirmation email failed:', err?.response || err);
  }
}

// ---------- Main handler ----------
export default async function handler(req, res) {
  // CORS
  const ALLOWED_ORIGINS = new Set([
  'https://postengineai.com',
  // Add your Vercel preview domains here:
  'https://postengineai.vercel.app',
  // Local dev:
  'http://localhost:3000'
]);
const reqOrigin = (req.headers.origin || '').toString();
if (ALLOWED_ORIGINS.has(reqOrigin)) {
  res.setHeader('Access-Control-Allow-Origin', reqOrigin);
  res.setHeader('Vary', 'Origin');
}
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

    // Honeypot
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      return res.status(200).json({ ok: true });
    }

    const { name = '', email = '', niche = '', handle = '', source = 'Landing Page' } = body;

    // Basic email validation
    const emailOk = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));
    if (!emailOk(email)) return res.status(400).json({ error: 'Invalid email' });

    // --- Capture IP/UA + (optional) Geo from Vercel ---
    const ip =
      (req.headers['x-forwarded-for'] || '')
        .toString()
        .split(',')[0]
        .trim() || req.socket?.remoteAddress || null;
    const ua = (req.headers['user-agent'] || '').toString() || null;
    const country = (req.headers['x-vercel-ip-country'] || '').toString() || null;
    const region  = (req.headers['x-vercel-ip-country-region'] || '').toString() || null;
    const city    = (req.headers['x-vercel-ip-city'] || '').toString() || null;

    // Supabase env
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    const table = process.env.SUPABASE_TABLE || 'signups';
    if (!url || !key) return res.status(500).json({ error: 'Supabase env not configured' });

    // Upsert by email (requires unique index on signups(email))
    const endpoint = `${url}/rest/v1/${encodeURIComponent(table)}?on_conflict=email`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const r = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': 'application/json',
        Prefer: 'return=representation,resolution=merge-duplicates'
      },
      body: JSON.stringify([{
        name, email, niche, handle, source,
        ip, ua, country, region, city
      }])
    }).finally(() => clearTimeout(timeout));

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('Supabase insert failed:', detail);
      return res.status(502).json({ error: 'Supabase insert failed', detail });
    }

    const data = await r.json().catch(() => []);

    // Send emails (log failures if any)
    try {
      await sendOwnerEmail({ name, email, niche, handle, source });
      await sendUserConfirmEmail({ name, email });
    } catch (err) {
      console.error('Email sending threw:', err);
    }
    return res.status(200).json({ ok: true, record: Array.isArray(data) ? data[0] : null });
  } catch (e) {
    if (e && e.name === 'AbortError') return res.status(504).json({ error: 'Upstream timeout' });
    console.error('Server error:', e);
    return res.status(500).json({ error: 'Server error', detail: String(e) });
  }
}