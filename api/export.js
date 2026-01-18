import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import fs from 'fs';
import fetch from 'node-fetch';
import { v4 as uuid } from 'uuid';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.post('/export', async (req, res) => {
  try {
    const { videoUrl, audioUrl } = req.body;

    if (!videoUrl || !audioUrl) {
      return res.status(400).json({ error: 'videoUrl and audioUrl are required' });
    }

    const id = uuid();
    const videoPath = `/tmp/${id}.mp4`;
    const audioPath = `/tmp/${id}.mp3`;
    const outPath = `/tmp/${id}-final.mp4`;

    await download(videoUrl, videoPath);
    await download(audioUrl, audioPath);

    const cmd = `
      ffmpeg -y \
      -i "${videoPath}" \
      -i "${audioPath}" \
      -map 0:v:0 \
      -map 1:a:0 \
      -shortest \
      -c:v libx264 \
      -c:a aac \
      -pix_fmt yuv420p \
      "${outPath}"
    `;

    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error('FFmpeg error:', stderr);
        return res.status(500).json({ error: 'FFmpeg failed', details: stderr });
      }

      res.json({
        success: true,
        output: outPath,
        downloadUrl: `/download?file=${encodeURIComponent(outPath)}`
      });
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/download', (req, res) => {
  const file = req.query.file;

  if (!file || !file.startsWith('/tmp/')) {
    return res.status(400).send('Invalid file');
  }

  if (!fs.existsSync(file)) {
    return res.status(404).send('File not found');
  }

  res.download(file);
});

app.listen(3001);