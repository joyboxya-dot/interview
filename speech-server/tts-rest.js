import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

/** 캐시 키 버전 — 속도·스타일 바꿀 때 올리면 예전 빠른 MP3 무시 */
export const TTS_CACHE_VERSION = 'v5-l2-playback-rate';

/** 서버 TTS 프로필 (클라이언트 user-settings.js 와 맞춤) */
export const TTS_PROFILES = {
  normal: {
    en: {
      voice: process.env.TTS_VOICE_EN || 'en-US-AriaNeural',
      /** newscast-formal 은 너무 빠름 → empathetic + 느린 rate */
      style: process.env.TTS_STYLE_EN || 'empathetic',
      rate: process.env.TTS_RATE_EN || '72%',
      pitch: '+5%',
    },
    ko: {
      voice: process.env.TTS_VOICE_KO || 'ko-KR-SunHiNeural',
      rate: '78%',
      pitch: '+2%',
    },
  },
  practice: {
    en: {
      voice: process.env.TTS_PRACTICE_VOICE_EN || process.env.TTS_VOICE_EN || 'en-US-AriaNeural',
      /** 과장 톤 — 속도는 대시보드「틀린 단어」콤보가 담당 (SSML은 너무 느리지 않게) */
      style: process.env.TTS_PRACTICE_STYLE_EN || '',
      rate: process.env.TTS_PRACTICE_SSML_RATE || '78%',
      pitch: '+10%',
      emphasis: true,
    },
    ko: {
      voice: process.env.TTS_VOICE_KO || 'ko-KR-SunHiNeural',
      rate: '78%',
      pitch: '+6%',
      emphasis: true,
    },
  },
};

export function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ratePercentFromPlayback(playbackRate, fallbackPercent) {
  const base = parseFloat(String(fallbackPercent || '82%').replace('%', ''));
  const mult = typeof playbackRate === 'number' && playbackRate > 0 ? playbackRate : 0.82;
  const pct = Math.round(Math.max(40, Math.min(110, base * (mult / 0.82))));
  return `${pct}%`;
}

export function buildSsml(text, profile, lang, options = {}) {
  const langKey = lang === 'ko' ? 'ko' : 'en';
  const xmlLang = langKey === 'ko' ? 'ko-KR' : 'en-US';
  const cfg = (TTS_PROFILES[profile] || TTS_PROFILES.normal)[langKey] || TTS_PROFILES.normal.en;

  let inner = escapeXml(text);
  if (cfg.emphasis) {
    inner = `<emphasis level="strong">${inner}</emphasis>`;
  }
  const prosodyParts = [];
  const rateStr =
    options.playbackRate != null
      ? ratePercentFromPlayback(options.playbackRate, cfg.rate)
      : cfg.rate;
  if (rateStr) prosodyParts.push(`rate="${rateStr}"`);
  if (cfg.pitch) prosodyParts.push(`pitch="${cfg.pitch}"`);
  if (prosodyParts.length) {
    inner = `<prosody ${prosodyParts.join(' ')}>${inner}</prosody>`;
  }
  if (cfg.style && langKey === 'en') {
    inner = `<mstts:express-as style="${cfg.style}">${inner}</mstts:express-as>`;
  }

  return (
    `<speak version="1.0" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${xmlLang}">` +
    `<voice name="${cfg.voice}">${inner}</voice></speak>`
  );
}

export function ttsCacheKey(profile, lang, text, playbackRate) {
  const langKey = lang === 'ko' ? 'ko' : 'en';
  const cfg = (TTS_PROFILES[profile] || TTS_PROFILES.normal)[langKey];
  const voice = cfg ? cfg.voice : 'default';
  const rateTag =
    playbackRate != null ? ratePercentFromPlayback(playbackRate, cfg?.rate) : cfg?.rate || '';
  const tag =
    TTS_CACHE_VERSION +
    '|' +
    profile +
    '|' +
    voice +
    '|' +
    (cfg?.style || '') +
    '|' +
    rateTag +
    '|' +
    langKey;
  return crypto.createHash('sha256').update(`${tag}\n${text}`).digest('hex');
}

export async function synthesizeToMp3({ speechKey, region, text, profile, lang, playbackRate }) {
  const regionHost = region.toLowerCase();
  const url = `https://${regionHost}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const langKey = lang === 'ko' ? 'ko' : 'en';
  const cfg = (TTS_PROFILES[profile] || TTS_PROFILES.normal)[langKey];
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': speechKey,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
    },
    body: buildSsml(text, profile, lang, { playbackRate }),
  });
  if (!res.ok) {
    const detail = await res.text();
    return { ok: false, detail: detail.slice(0, 500), voice: cfg?.voice };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { ok: true, buffer: buf };
}

export async function readCachedMp3(cacheDir, key) {
  try {
    const filePath = path.join(cacheDir, `${key}.mp3`);
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

export async function writeCachedMp3(cacheDir, key, buffer) {
  await fs.mkdir(cacheDir, { recursive: true });
  const filePath = path.join(cacheDir, `${key}.mp3`);
  await fs.writeFile(filePath, buffer);
  return filePath;
}
