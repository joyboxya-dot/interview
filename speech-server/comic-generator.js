/**
 * 주제당 STAR 4컷 SVG 생성
 */
import fs from 'fs';
import path from 'path';

const W = 200;
const H = 150;

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shortenKo(text, maxLen) {
  let t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen - 1) + '…';
}

/** 문장 배열 → 4컷 한글 라벨 */
export function pickStarLabels(topic) {
  let ko = (topic.sentences || []).map((s) => (Array.isArray(s) ? s[0] : s.ko) || '').filter(Boolean);
  if (!ko.length && topic.kor) {
    ko = String(topic.kor)
      .split(/(?<=[.!?。])\s+|[\n]+/)
      .map((x) => x.trim())
      .filter((x) => x.length > 2);
  }
  if (!ko.length) {
    const t = topic.title || '주제';
    return [t, t, t, t].map((x) => shortenKo(x, 14));
  }
  const n = ko.length;
  if (n === 1) return [shortenKo(ko[0], 14), shortenKo(ko[0], 14), shortenKo(ko[0], 14), shortenKo(ko[0], 14)];
  if (n === 2) {
    return [shortenKo(ko[0], 14), shortenKo(ko[1], 14), shortenKo(ko[1], 14), shortenKo(ko[1], 14)];
  }
  if (n === 3) {
    return [shortenKo(ko[0], 14), shortenKo(ko[1], 14), shortenKo(ko[2], 14), shortenKo(ko[2], 14)];
  }
  const i1 = Math.max(1, Math.floor(n / 3));
  const i2 = Math.max(i1 + 1, Math.floor((2 * n) / 3));
  return [
    shortenKo(ko[0], 14),
    shortenKo(ko[i1], 14),
    shortenKo(ko[i2], 14),
    shortenKo(ko[n - 1], 14),
  ];
}

function detectVisual(label) {
  const t = String(label);
  if (/NPS|고도화|프로젝트/.test(t)) return 'nps';
  if (/문서|가이드|페이지|200/.test(t)) return 'doc';
  if (/결산|800|억|달러|시스템/.test(t)) return 'money';
  if (/ETL|로그/.test(t)) return 'log';
  if (/이중|두\s*번|확인|체크/.test(t)) return 'dual';
  if (/비효율|어렵|부족|문제|약점|긴장/.test(t)) return 'problem';
  if (/퇴근|야간|🌙|개인/.test(t)) return 'night';
  if (/스크립트|shell|쉘|코드|Python|AWS|Snowflake|클라우드|독학/.test(t)) return 'code';
  if (/UI|화면|MTS|API|모바일/.test(t)) return 'ui';
  if (/협업|팀|외부|갈등|설득/.test(t)) return 'team';
  if (/장애|개장|배치|장애|실시간/.test(t)) return 'alert';
  if (/가족|미국|정착|커리어/.test(t)) return 'family';
  if (/문법|영어|학습/.test(t)) return 'study';
  if (/절약|결과|안정|표준|성공|해결/.test(t)) return 'success';
  if (/합류|운영|엔지니어/.test(t)) return 'join';
  if (/준비|정확/.test(t)) return 'check';
  return 'default';
}

function person(x, y, color = '#6366F1') {
  return `<circle cx="${x}" cy="${y}" r="14" fill="${color}"/>
  <rect x="${x - 12}" y="${y + 12}" width="24" height="28" rx="6" fill="${color}"/>`;
}

function monitor(x, y, w, h, title, accent = '#6366F1') {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#E2E8F0" stroke="#94A3B8" stroke-width="2"/>
  <rect x="${x + 8}" y="${y + 8}" width="${w - 16}" height="${h - 22}" rx="4" fill="#FFFFFF"/>
  <text x="${x + w / 2}" y="${y + 24}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" font-weight="800" fill="${accent}">${esc(title)}</text>`;
}

function badge(x, y, text, bg = '#FEF3C7', fg = '#92400E') {
  const tw = Math.max(40, text.length * 12 + 16);
  return `<rect x="${x}" y="${y}" width="${tw}" height="24" rx="12" fill="${bg}"/>
  <text x="${x + tw / 2}" y="${y + 17}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" font-weight="800" fill="${fg}">${esc(text)}</text>`;
}

function drawVisual(kind, stepIndex) {
  switch (kind) {
    case 'nps':
      return monitor(30, 40, 90, 62, 'NPS') + person(140, 50, '#059669');
    case 'doc':
      return monitor(35, 32, 90, 72, 'DOC', '#7C3AED') + badge(115, 48, '200p', '#EDE9FE', '#5B21B6');
    case 'money':
      return badge(50, 38, '$800B', '#D1FAE5', '#047857') + monitor(95, 42, 85, 58, 'SYS');
    case 'log':
      return monitor(25, 34, 150, 70, 'LOG', '#D97706') + badge(70, 88, 'ETL', '#FEF3C7', '#92400E');
    case 'dual':
      return monitor(18, 38, 72, 58, 'A') + monitor(110, 38, 72, 58, 'B') + badge(62, 88, '2번');
    case 'problem':
      return person(75, 42, '#DB2777') + `<text x="115" y="72" font-size="32" fill="#DC2626">!</text>`;
    case 'night':
      return `<text x="40" y="62" font-size="36">🌙</text>` + monitor(75, 38, 100, 65, 'work');
    case 'code':
      return monitor(30, 34, 140, 72, 'code', '#059669') + badge(55, 88, '{ }');
    case 'ui':
      return monitor(25, 28, 150, 78, 'UI', '#059669');
    case 'team':
      return person(45, 42) + person(85, 42) + person(125, 42);
    case 'alert':
      return monitor(40, 36, 120, 62, 'BATCH', '#DC2626') + badge(55, 88, '!', '#FEE2E2', '#B91C1C');
    case 'family':
      return person(55, 40) + person(95, 40, '#EC4899') + `<text x="140" y="58" font-size="24">🏠</text>`;
    case 'study':
      return monitor(40, 36, 120, 65, 'EN', '#6366F1') + badge(70, 88, 'study');
    case 'success':
      return `<circle cx="85" cy="58" r="28" fill="#ECFDF5" stroke="#059669" stroke-width="3"/>
      <text x="85" y="66" text-anchor="middle" font-size="22" fill="#059669">✓</text>` + badge(118, 42, 'OK', '#D1FAE5', '#047857');
    case 'join':
      return person(50, 42) + `<line x1="88" y1="62" x2="130" y2="62" stroke="#6366F1" stroke-width="4"/>` + person(145, 42, '#059669');
    case 'check':
      return person(70, 40) + badge(105, 48, '2x check') + badge(48, 88, '준비');
    default:
      if (stepIndex === 0) return person(80, 45) + badge(55, 88, '상황');
      if (stepIndex === 1) return badge(55, 42, '?', '#FEE2E2', '#B91C1C') + monitor(40, 58, 120, 42, '…');
      if (stepIndex === 2) return person(70, 42) + monitor(110, 38, 70, 60, 'act');
      return `<circle cx="85" cy="58" r="26" fill="#ECFDF5" stroke="#059669" stroke-width="3"/>
      <text x="85" y="66" text-anchor="middle" font-size="20" fill="#059669">✓</text>`;
  }
}

const STEP_TAGS = ['1 상황', '2 문제', '3 행동', '4 결과'];

export function buildPanelSvg(stepTag, label, stepIndex) {
  const visual = drawVisual(detectVisual(label), stepIndex);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
  <rect width="${W}" height="${H}" fill="#F8FAFC" rx="10"/>
  <rect x="8" y="8" width="56" height="22" rx="11" fill="#E0E7FF"/>
  <text x="36" y="23" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" font-weight="800" fill="#4338CA">${esc(stepTag)}</text>
  <rect x="0" y="108" width="${W}" height="42" fill="#FFFFFF"/>
  <line x1="0" y1="108" x2="${W}" y2="108" stroke="#E2E8F0" stroke-width="1"/>
  ${visual}
  <text x="${W / 2}" y="132" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="12" font-weight="700" fill="#1E293B">${esc(label)}</text>
</svg>`;
}

export function buildSvgPanels(topic) {
  const labels = pickStarLabels(topic);
  return labels.map((label, i) => ({
    stepTag: STEP_TAGS[i],
    label,
    svg: buildPanelSvg(STEP_TAGS[i], label, i),
  }));
}

export function svgToDataUri(svg) {
  return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
}

/**
 * @param {object} topic
 * @param {{ contentRoot?: string, preferFiles?: boolean }} opts
 */
export function generateTopicComic(topic, opts = {}) {
  const topicId = topic.id || 'topic-custom';
  const panelsBuilt = buildSvgPanels(topic);
  const labels = panelsBuilt.map((p) => p.label);
  const captionKo = labels.join(' → ');

  const contentRoot = opts.contentRoot;
  const preferFiles = opts.preferFiles !== false && contentRoot;

  if (preferFiles) {
    const dir = path.join(contentRoot, 'comics', topicId);
    fs.mkdirSync(dir, { recursive: true });
    const urls = panelsBuilt.map((p, i) => {
      const fname = `panel-${i + 1}.svg`;
      fs.writeFileSync(path.join(dir, fname), p.svg, 'utf8');
      return `/content/comics/${topicId}/${fname}`;
    });
    return { topicComic: { captionKo, panels: urls }, wroteFiles: true };
  }

  const urls = panelsBuilt.map((p) => svgToDataUri(p.svg));
  return { topicComic: { captionKo, panels: urls }, wroteFiles: false };
}

export function writeTopicComicFiles(topic, contentRoot) {
  return generateTopicComic(topic, { contentRoot, preferFiles: true });
}
