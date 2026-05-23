import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { assessShortAudioPronunciation } from './pronunciation-rest.js';
import {
  readCachedMp3,
  synthesizeToMp3,
  ttsCacheKey,
  writeCachedMp3,
} from './tts-rest.js';
import { evolinkConfigured, generateInterviewScript } from './script-evolink.js';
import { generateTopicComic } from './comic-generator.js';

/** Deployed pronunciation-rest.js 가 오래된 경우에도 서버가 기동되도록 로컬 검증 */
function validateWav16kMono(buffer) {
  if (!buffer || buffer.length < 44) {
    return { ok: false, error: 'wav_too_short', detail: '녹음이 너무 짧습니다.' };
  }
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return { ok: false, error: 'wav_invalid', detail: 'WAV 변환 실패 — 브라우저를 새로고침 후 다시 녹음하세요.' };
  }
  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  if (channels !== 1) {
    return { ok: false, error: 'wav_not_mono', detail: `channels=${channels}` };
  }
  if (sampleRate !== 16000) {
    return { ok: false, error: 'wav_wrong_rate', detail: `rate=${sampleRate} (need 16000)` };
  }
  const dataBytes = buffer.length - 44;
  if (dataBytes < 3200) {
    return { ok: false, error: 'wav_too_short', detail: '1초 이상 말한 뒤 종료하세요.' };
  }
  return { ok: true };
}

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

/** pronounce-assess 는 전용 파서(최대 6MB) 사용 — 전역 json 이 body 를 먼저 소비하면 referenceText 가 사라질 수 있음 */
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/api/pronounce-assess') {
    return next();
  }
  return express.json({ limit: '1mb' })(req, res, next);
});

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

const TTS_CACHE_DIR = path.join(__dirname, 'tts-cache');

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, region: SPEECH_REGION, mode: 'short-audio-rest', tts: true });
});

app.post('/api/tts', async (req, res) => {
  try {
    const text = normalizeReferenceText(req.body && req.body.text);
    const lang = (req.body && req.body.lang) === 'ko' ? 'ko' : 'en';
    const profile = req.body && req.body.profile === 'practice' ? 'practice' : 'normal';
    let playbackRate = parseFloat(req.body && req.body.playbackRate);
    if (isNaN(playbackRate) || playbackRate < 0.4 || playbackRate > 1.2) {
      playbackRate = undefined;
    }
    if (!text) {
      return res.status(400).json({ ok: false, error: 'missing_text' });
    }
    if (text.length > 8000) {
      return res.status(400).json({ ok: false, error: 'text_too_long' });
    }
    const key = ttsCacheKey(profile, lang, text, playbackRate);
    let mp3 = await readCachedMp3(TTS_CACHE_DIR, key);
    if (!mp3) {
      const syn = await synthesizeToMp3({
        speechKey: SPEECH_KEY,
        region: SPEECH_REGION,
        text,
        profile,
        lang,
        playbackRate,
      });
      if (!syn.ok) {
        return res.status(502).json({ ok: false, error: 'tts_failed', detail: syn.detail });
      }
      mp3 = syn.buffer;
      await writeCachedMp3(TTS_CACHE_DIR, key, mp3);
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Tts-Cache', 'hit-or-miss');
    res.send(mp3);
  } catch (err) {
    console.error('tts', err);
    res.status(500).json({ ok: false, error: 'server_error', detail: String(err) });
  }
});

function normalizeReferenceText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function readReferenceText(req) {
  const refHeader = req.headers['x-reference-text'];
  if (refHeader) {
    try {
      const decoded = decodeURIComponent(String(refHeader));
      const normalized = normalizeReferenceText(decoded);
      if (normalized) return normalized;
    } catch {
      const normalized = normalizeReferenceText(refHeader);
      if (normalized) return normalized;
    }
  }
  if (req.query && req.query.referenceText) {
    const fromQuery = normalizeReferenceText(req.query.referenceText);
    if (fromQuery) return fromQuery;
  }
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) && req.body.referenceText) {
    return normalizeReferenceText(req.body.referenceText);
  }
  return '';
}

async function handlePronounceAssess(req, res) {
  try {
    let referenceText = readReferenceText(req);
    let audioBuffer = null;

    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) && req.body.audioBase64) {
      if (!referenceText) {
        referenceText = String(req.body.referenceText || '').replace(/\s+/g, ' ').trim();
      }
      audioBuffer = Buffer.from(String(req.body.audioBase64), 'base64');
    } else if (Buffer.isBuffer(req.body) && req.body.length) {
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

/** Content-Type 별로 파서 하나만 사용 (json+raw 동시에 쓰면 body가 비워짐) */
function pronounceAssessParser(req, res, next) {
  const ct = (req.headers['content-type'] || '').toLowerCase();
  if (ct.includes('application/json')) {
    return express.json({ limit: '6mb' })(req, res, next);
  }
  return express.raw({
    type: ['audio/wav', 'application/octet-stream', 'audio/*'],
    limit: '4mb',
  })(req, res, next);
}

/**
 * 2단계 발음 평가 — Azure Short Audio REST
 * JSON: { referenceText, audioBase64 } + X-Reference-Text(백업)
 * 또는 raw WAV + X-Reference-Text
 */
app.post('/api/pronounce-assess', pronounceAssessParser, handlePronounceAssess);

/** 면접 스크립트 AI 생성 (EvoLink) */
app.post('/api/generate-script', async (req, res) => {
  try {
    const result = await generateInterviewScript(req.body || {});
    res.json({ ok: true, topic: result.topic, model: result.model });
  } catch (err) {
    const status = err.status || 500;
    const code = err.message || 'server_error';
    console.error('generate-script', code, err.detail || '');
    res.status(status).json({
      ok: false,
      error: code,
      detail: err.detail ? String(err.detail).slice(0, 200) : undefined,
      raw: err.raw,
    });
  }
});

app.get('/api/generate-script/status', (_req, res) => {
  res.json({ ok: true, configured: evolinkConfigured() });
});

/** 주제 4컷 SVG 생성 — preferFiles:true 시 content/comics/{id}/ 저장 */
app.post('/api/generate-topic-comic', async (req, res) => {
  try {
    const body = req.body || {};
    const topic = body.topic;
    if (!topic || !topic.sentences?.length) {
      return res.status(400).json({ ok: false, error: 'topic_required' });
    }
    const parentDir = path.join(__dirname, '..');
    const contentRoot = path.join(parentDir, 'content');
    const preferFiles = body.preferFiles === true;
    let result;
    try {
      result = generateTopicComic(topic, {
        contentRoot,
        preferFiles,
      });
    } catch (writeErr) {
      result = generateTopicComic(topic, { preferFiles: false });
    }
    res.json({
      ok: true,
      topicComic: result.topicComic,
      wroteFiles: result.wroteFiles,
    });
  } catch (err) {
    console.error('generate-topic-comic', err);
    res.status(500).json({ ok: false, error: 'comic_failed', detail: String(err.message) });
  }
});

const parentDir = path.join(__dirname, '..');
app.use(express.static(parentDir));

app.listen(PORT, () => {
  console.log(`Speech server: http://localhost:${PORT}`);
  console.log(`앱: http://localhost:${PORT}/index.html`);
  console.log(`2단계 발음: POST /api/pronounce-assess (Short Audio REST)`);
  console.log(`TTS 캐시: POST /api/tts → ${TTS_CACHE_DIR}`);
  console.log(
    `스크립트 AI: POST /api/generate-script (EvoLink ${evolinkConfigured() ? '설정됨' : '미설정 — EVOLINK_API_KEY'})`
  );
});
