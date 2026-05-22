import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { assessShortAudioPronunciation } from './pronunciation-rest.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const SPEECH_KEY = process.env.SPEECH_KEY;
const SPEECH_REGION = (process.env.SPEECH_REGION || 'eastus').toLowerCase();

if (!SPEECH_KEY) {
  console.error('SPEECH_KEY 가 없습니다. speech-server/.env 파일을 만드세요.');
  process.exit(1);
}

app.use(cors());
app.use(express.json({ limit: '1mb' }));

/** 브라우저용 Speech 토큰 (레거시·선택) */
app.get('/api/speech-token', async (_req, res) => {
  try {
    const tokenRes = await fetch(
      `https://${SPEECH_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
      {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': SPEECH_KEY,
          'Content-Length': '0',
        },
      }
    );
    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      return res.status(tokenRes.status).json({ error: 'token_failed', detail: body });
    }
    const token = await tokenRes.text();
    res.json({ token, region: SPEECH_REGION });
  } catch (err) {
    res.status(500).json({ error: 'token_failed', detail: String(err) });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, region: SPEECH_REGION, mode: 'short-audio-rest' });
});

/**
 * 2단계 문장별 발음 평가 — Azure Short Audio REST (저렴·Miscue·운율)
 * Body: WAV PCM 16kHz mono
 * Header: X-Reference-Text (encodeURIComponent 된 영어 스크립트)
 */
app.post(
  '/api/pronounce-assess',
  express.raw({ type: ['audio/wav', 'application/octet-stream', 'audio/*'], limit: '4mb' }),
  async (req, res) => {
    try {
      const refHeader = req.headers['x-reference-text'];
      const referenceText = refHeader
        ? decodeURIComponent(String(refHeader))
        : '';
      if (!referenceText.trim()) {
        return res.status(400).json({ ok: false, error: 'missing_reference_text' });
      }
      if (!req.body || !req.body.length) {
        return res.status(400).json({ ok: false, error: 'missing_audio' });
      }

      const result = await assessShortAudioPronunciation({
        speechKey: SPEECH_KEY,
        region: SPEECH_REGION,
        referenceText,
        audioBuffer: req.body,
      });

      if (!result.ok) {
        return res.status(result.httpStatus && result.httpStatus >= 400 ? result.httpStatus : 502).json({
          ok: false,
          error: result.message || 'assessment_failed',
          detail: result.detail,
        });
      }

      res.json({
        ok: true,
        text: result.text,
        accuracyScore: result.accuracyScore,
        fluencyScore: result.fluencyScore,
        completenessScore: result.completenessScore,
        prosodyScore: result.prosodyScore,
        pronunciationScore: result.pronunciationScore,
        words: result.words,
      });
    } catch (err) {
      console.error('pronounce-assess', err);
      res.status(500).json({ ok: false, error: 'server_error', detail: String(err) });
    }
  }
);

const parentDir = path.join(__dirname, '..');
app.use(express.static(parentDir));

app.listen(PORT, () => {
  console.log(`Speech server: http://localhost:${PORT}`);
  console.log(`앱: http://localhost:${PORT}/index.html`);
  console.log(`2단계 발음: POST /api/pronounce-assess (Short Audio REST)`);
});
