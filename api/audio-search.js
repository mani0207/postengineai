export default async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  
    try {
      const { mood } = req.body || {};
      const q = (mood || 'calm').toString().slice(0, 40);
  
      const key = process.env.PIXABAY_API_KEY;
      if (!key) {
        return res.status(500).json({ error: 'Pixabay API key not configured' });
      }
  
      const url = `https://pixabay.com/api/music/?key=${key}&q=${encodeURIComponent(q)}&per_page=6`;
      const r = await fetch(url);
      if (!r.ok) {
        return res.status(502).json({ error: 'Pixabay request failed' });
      }
  
      const j = await r.json();
  
      const items = (j.hits || []).map(h => ({
        id: h.id,
        title: h.tags || 'Audio track',
        preview: h.previewURL,
        duration: h.duration
      }));
  
      res.status(200).json(items);
    } catch (e) {
      res.status(500).json({ error: e.message || 'Server error' });
    }
  }