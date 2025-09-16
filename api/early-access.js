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
    const from = process.env.NOTIFY_FROM || process.env.SMTP_USER; // MUST be a verified sender in Mailjet
    const to = process.env.NOTIFY_TO || 'manisundar.92@gmail.com';
    await tx.sendMail({
      from, to,
      subject: `New early-access signup: ${email}`,
      html: `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;line-height:1.5;">
          <h2 style="margin:0 0 8px">New signup</h2>
          <p><strong>Name:</strong> ${name || '-'}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Niche:</strong> ${niche || '-'}</p>
          <p><strong>Handle:</strong> ${handle || '-'}</p>
          <p><strong>Source:</strong> ${source || '-'}</p>
        </div>`
    });
  } catch (err) {
    console.error('Owner email failed:', err?.response || err);
  }
}

async function sendUserConfirmEmail({ name, email }) {
  try {
    const tx = await getTransporter(); if (!tx || !email) return;
    const from = process.env.NOTIFY_FROM || process.env.SMTP_USER; // MUST be verified in Mailjet
    await tx.sendMail({
      from,
      to: email,
      subject: `You're on the waitlist — postEngineAI`,
      html: `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;line-height:1.6;">
          <h2 style="margin:0 0 10px;">Thanks for joining early access${name ? `, ${name}` : ''}!</h2>
          <p>We’ll email your invite as soon as your spot opens up.</p>
          <ul>
            <li>Caption ideas, stories, and hashtags tailored to your niche.</li>
            <li>Your price is locked at <strong>$9/mo</strong> as an early member.</li>
          </ul>
          <p style="margin-top:12px;">Questions? Just reply to this email.</p>
          <p style="margin-top:20px;">— Team postEngineAI</p>
        </div>`
    });
  } catch (err) {
    console.error('User confirmation email failed:', err?.response || err);
  }
}

// ---------- Main handler ----------
export default async function handler(req, res) {
  // CORS
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