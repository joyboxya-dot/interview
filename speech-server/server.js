import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

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
app.use(express.json());

/** 브라우저용 10분짜리 Speech 토큰 (구독 키는 서버에만 둠) */
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
  res.json({ ok: true, region: SPEECH_REGION });
});

// index.html 을 http://localhost:3001/ 로 열 수 있게 (file:// CORS 방지)
const parentDir = path.join(__dirname, '..');
app.use(express.static(parentDir));

app.listen(PORT, () => {
  console.log(`Speech token server: http://localhost:${PORT}`);
  console.log(`앱 열기: http://localhost:${PORT}/index.html`);
  console.log(`토큰 테스트: http://localhost:${PORT}/api/health`);
});
