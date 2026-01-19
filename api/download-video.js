export default async function handler(req, res) {
    const file = req.query.file;
    if (!file) return res.status(400).end();
  
    const r = await fetch(
      `http://163.192.104.44:3001/download?file=${encodeURIComponent(file)}`
    );
  
    res.setHeader(
      'Content-Disposition',
      r.headers.get('content-disposition') || 'attachment'
    );
    r.body.pipe(res);
  }