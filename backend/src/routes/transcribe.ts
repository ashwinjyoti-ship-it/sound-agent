import express from 'express';
import multer from 'multer';
import OpenAI, { toFile } from 'openai';
import { OPENAI_API_KEY } from '../config';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

router.post('/', upload.single('audio'), async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured on server' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file received' });
  }

  try {
    const client = new OpenAI({ apiKey: OPENAI_API_KEY });

    const ext = req.file.mimetype.includes('mp4') ? 'recording.mp4'
      : req.file.mimetype.includes('ogg') ? 'recording.ogg'
      : req.file.mimetype.includes('wav') ? 'recording.wav'
      : 'recording.webm';

    const file = await toFile(req.file.buffer, ext, { type: req.file.mimetype });

    const result = await client.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: 'en',
    });

    res.json({ text: result.text });
  } catch (err: any) {
    console.error('Transcription error:', err);
    res.status(500).json({ error: err.message || 'Transcription failed' });
  }
});

export { router as transcribeRoute };
