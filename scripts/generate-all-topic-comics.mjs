#!/usr/bin/env node
/** manifest의 모든 topic JSON에 4컷 SVG 생성 + topicComic 갱신 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
  console.log('OK', topic.id, topicComic.captionKo);
  ok += 1;
}
console.log(`Done: ${ok} topics`);
