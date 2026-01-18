export const config = {
    runtime: 'nodejs',
  };
  
  export default async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  
    try {
      const body = req.body || {};
      const rawMood = (body.mood || 'calm').toString().slice(0, 40).toLowerCase();
      const moodMap = {
        calm: 'ambient relaxing soft pad',
        energetic: 'upbeat energetic fast music',
        cinematic: 'cinematic trailer epic score',
        vlog: 'vlog background chill music'
      };
      const q = moodMap[rawMood] || rawMood;
  
      const key = process.env.FREESOUND_API_KEY;
      if (!key) {
        return res.status(500).json({ error: 'Freesound API key not configured' });
      }
  
      const url =
        `https://freesound.org/apiv2/search/text/?` +
        `query=${encodeURIComponent(q)}` +
        `&filter=duration:[5 TO 60]` +
        `&fields=id,name,previews,license,username,url` +
        `&page_size=10`;
  
      const r = await fetch(url, {
        headers: {
          Authorization: `Token ${key}`,
          Accept: 'application/json',
          'User-Agent': 'postengineai/1.0',
        },
      });
  
      if (!r.ok) {
        const t = await r.text();
        return res.status(502).json({
          error: 'Freesound request failed',
          status: r.status,
          body: t,
        });
      }
  
      const j = await r.json();
  
      // Allow only safe licenses
      const allowed = ['Creative Commons 0', 'Attribution'];
  
      const items = (j.results || [])
        .filter(a => allowed.includes(a.license))
        .map(a => ({
          id: a.id,
          title: a.name,
          preview: a.previews['preview-hq-mp3'] || a.previews['preview-lq-mp3'],
          license: a.license,
          attribution:
            a.license === 'Attribution'
              ? `Audio by ${a.username} on Freesound.org`
              : null,
          source: a.url,
        }));
  
      res.status(200).json(items);
    } catch (e) {
      res.status(500).json({ error: e.message || 'Server error' });
    }
  }