  // /api/early-access.js
  export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();

    try {
      const form = Object.fromEntries((await req.body?.get?.('email')) ? req.body : await (async () => {
        // Support both FormData and urlencoded/json
        const ct = req.headers['content-type'] || '';
        if (ct.includes('multipart/form-data')) {
          const data = await req.formData();
          return data;
        } else if (ct.includes('application/json')) {
          return new Map(Object.entries(await new Promise(r => {
            let body=''; req.on('data', c=> body+=c); req.on('end', ()=> r(JSON.parse(body||'{}')));
          })));
        } else {
          // urlencoded
          const body = await new Promise(r => { let b=''; req.on('data', c=> b+=c); req.on('end', ()=> r(b)); });
          const params = new URLSearchParams(body);
          return params;
        }
      })());

      const name = form.get ? form.get('name') : form.name;
      const email = form.get ? form.get('email') : form.email;
      const niche = form.get ? form.get('niche') : form.niche;
      const handle = form.get ? form.get('handle') : form.handle;
      const source = form.get ? form.get('source') : form.source;

      if (!email) return res.status(400).json({ error: 'Email required' });

      const token = process.env.AIRTABLE_TOKEN;
      const base = process.env.AIRTABLE_BASE_ID;
      const table = process.env.AIRTABLE_TABLE || 'Early Access';

      const atRes = await fetch(`https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}` ,{
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          records: [{ fields: {
            Name: name || '',
            Email: email,
            Niche: niche || '',
            Handle: handle || '',
            Source: source || 'Landing Page',
            Timestamp: new Date().toISOString()
          }}]
        })
      });

      if (!atRes.ok) {
        const text = await atRes.text();
        return res.status(500).json({ error: 'Airtable error', detail: text });
      }

      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: 'Server error', detail: String(e) });
    }
  }