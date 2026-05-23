#!/usr/bin/env node
/** manifest의 모든 topic JSON에 4컷 SVG 생성 + topicComic 갱신 · 중복 검사 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { generateTopicComic } from '../speech-server/comic-generator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const contentRoot = path.join(root, 'content');
const topicsDir = path.join(contentRoot, 'topics');
const manifestPath = path.join(contentRoot, 'manifest.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const ids = manifest.topicIds || [];

let ok = 0;
for (const id of ids) {
  const file = path.join(topicsDir, id.endsWith('.json') ? id : id + '.json');
  if (!fs.existsSync(file)) {
    console.warn('skip missing', file);
    continue;
  }
  const topic = JSON.parse(fs.readFileSync(file, 'utf8'));
  topic.id = topic.id || id.replace(/\.json$/, '');
  const { topicComic } = generateTopicComic(topic, { contentRoot, preferFiles: true });
  topic.topicComic = topicComic;
  delete topic.sentenceComics;
  fs.writeFileSync(file, JSON.stringify(topic, null, 2) + '\n', 'utf8');
  console.log('OK', topic.id);
  ok += 1;
}
console.log(`Done: ${ok} topics`);

const comicsRoot = path.join(contentRoot, 'comics');
const dupReport = [];
for (let p = 1; p <= 4; p++) {
  const byHash = new Map();
  for (const id of ids) {
    const tid = id.replace(/\.json$/, '');
    const fp = path.join(comicsRoot, tid, `panel-${p}.svg`);
    if (!fs.existsSync(fp)) continue;
    const h = createHash('md5').update(fs.readFileSync(fp)).digest('hex');
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push(tid);
  }
  for (const [hash, topics] of byHash) {
    if (topics.length > 1) dupReport.push({ panel: p, hash, topics });
  }
}
if (dupReport.length) {
  console.warn('WARNING: duplicate panel SVGs detected:');
  dupReport.forEach((d) => console.warn(`  panel-${d.panel}: ${d.topics.join(', ')}`));
  process.exitCode = 1;
} else {
  console.log('All 40 panels are visually unique (MD5 check passed).');
}
