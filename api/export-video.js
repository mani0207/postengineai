export default async function handler(req, res) {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  
    try {
      console.log('[export-video] incoming body:', req.body);
  
      const r = await fetch('http://10.0.0.140:3001/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });
  
      const text = await r.text(); // read as text FIRST
      console.log('[export-video] VM response status:', r.status);
      console.log('[export-video] VM raw response:', text);
  
      // Try parsing JSON safely
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('VM did not return JSON');
      }
  
      if (!r.ok) {
        return res.status(500).json({
          error: 'FFmpeg VM error',
          vmStatus: r.status,
          vmResponse: data,
        });
      }
  
      return res.status(200).json(data);
    } catch (e) {
      console.error('[export-video] proxy error:', e);
      return res.status(500).json({ error: e.message });
    }
  }