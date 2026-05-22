import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  assessShortAudioPronunciation,
  validateWav16kMono,
} from './pronunciation-rest.js';

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

async function handlePronounceAssess(req, res) {
  try {
    let referenceText = '';
    let audioBuffer = null;

    if (req.body && typeof req.body === 'object' && req.body.audioBase64) {
      referenceText = String(req.body.referenceText || '').replace(/\s+/g, ' ').trim();
      audioBuffer = Buffer.from(String(req.body.audioBase64), 'base64');
    } else if (Buffer.isBuffer(req.body) && req.body.length) {
      const refHeader = req.headers['x-reference-text'];
      referenceText = refHeader
        ? decodeURIComponent(String(refHeader))
        : '';
      audioBuffer = req.body;
    }

    if (!referenceText) {
      return res.status(400).json({ ok: false, error: 'missing_reference_text' });
    }
    if (!audioBuffer || !audioBuffer.length) {
      return res.status(400).json({ ok: false, error: 'missing_audio' });
    }

    const wavCheck = validateWav16kMono(audioBuffer);
    if (!wavCheck.ok) {
      return res.status(400).json({ ok: false, error: wavCheck.error, detail: wavCheck.detail });
    }

    const result = await assessShortAudioPronunciation({
      speechKey: SPEECH_KEY,
      region: SPEECH_REGION,
      referenceText,
      audioBuffer,
    });

    if (!result.ok) {
      console.warn('pronounce-assess azure', result.message, result.detail);
      return res.status(result.httpStatus && result.httpStatus >= 400 ? result.httpStatus : 502).json({
        ok: false,
        error: result.message || 'assessment_failed',
        detail: result.detail,
        azureStatus: result.status,
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

/**
 * 2단계 발음 평가 — Azure Short Audio REST
 * JSON: { referenceText, audioBase64 }  또는  raw WAV + X-Reference-Text
 */
app.post(
  '/api/pronounce-assess',
  express.json({ limit: '6mb' }),
  express.raw({ type: ['audio/wav', 'application/octet-stream', 'audio/*'], limit: '4mb' }),
  handlePronounceAssess
);

const parentDir = path.join(__dirname, '..');
app.use(express.static(parentDir));

app.listen(PORT, () => {
  console.log(`Speech server: http://localhost:${PORT}`);
  console.log(`앱: http://localhost:${PORT}/index.html`);
  console.log(`2단계 발음: POST /api/pronounce-assess (Short Audio REST)`);
});
