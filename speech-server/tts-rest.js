import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

/** 서버 TTS 프로필 (클라이언트 user-settings.js 와 맞춤) */
export const TTS_PROFILES = {
  normal: {
    en: {
      voice: process.env.TTS_VOICE_EN || 'en-US-AriaNeural',
      style: process.env.TTS_STYLE_EN || 'newscast-formal',
      rate: '90%',
      pitch: '+6%',
    },
    ko: {
      voice: process.env.TTS_VOICE_KO || 'ko-KR-SunHiNeural',
      rate: '92%',
      pitch: '+3%',
    },
  },
  practice: {
    en: {
      voice: process.env.TTS_PRACTICE_VOICE_EN || process.env.TTS_VOICE_EN || 'en-US-AriaNeural',
      style: process.env.TTS_PRACTICE_STYLE_EN || 'shouting',
      rate: 'x-slow',
      pitch: '+18%',
      emphasis: true,
    },
    ko: {
      voice: process.env.TTS_VOICE_KO || 'ko-KR-SunHiNeural',
      rate: 'x-slow',
      pitch: '+12%',
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

export function buildSsml(text, profile, lang) {
  const langKey = lang === 'ko' ? 'ko' : 'en';
  const xmlLang = langKey === 'ko' ? 'ko-KR' : 'en-US';
  const cfg = (TTS_PROFILES[profile] || TTS_PROFILES.normal)[langKey] || TTS_PROFILES.normal.en;

  let inner = escapeXml(text);
  if (cfg.emphasis) {
    inner = `<emphasis level="strong">${inner}</emphasis>`;
  }
  const prosodyParts = [];
  if (cfg.rate) prosodyParts.push(`rate="${cfg.rate}"`);
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

export function ttsCacheKey(profile, lang, text) {
  const langKey = lang === 'ko' ? 'ko' : 'en';
  const cfg = (TTS_PROFILES[profile] || TTS_PROFILES.normal)[langKey];
  const voice = cfg ? cfg.voice : 'default';
  const tag = profile + '|' + voice + '|' + (cfg?.style || '') + '|' + langKey;
  return crypto.createHash('sha256').update(`${tag}\n${text}`).digest('hex');
}

export async function synthesizeToMp3({ speechKey, region, text, profile, lang }) {
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
    body: buildSsml(text, profile, lang),
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
