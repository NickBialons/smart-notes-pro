import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'openrouter/owl-alpha';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function extractJson(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found');
  return JSON.parse(match[0]);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'POST' && req.url === '/api/analyze') {
    let body = '';
    req.on('data', chunk => body += chunk);

    req.on('end', async () => {
      try {
        if (!OPENROUTER_API_KEY) {
          return sendJson(res, 200, {
            summary: 'Ключ не задан.',
            keywords: ['notes', 'analysis'],
            tags: ['draft'],
            fallback: true
          });
        }

        const { prompt } = JSON.parse(body || '{}');

        const systemPrompt = `
Ты анализируешь заметки пользователя.
Верни СТРОГО JSON без markdown и без лишнего текста:
{
  "summary": "1-2 коротких предложения",
  "keywords": ["ключ1", "ключ2", "ключ3", "ключ4", "ключ5"],
  "tags": ["тег1", "тег2", "тег3"]
}
Правила:
- summary краткий и понятный
- keywords только важные слова и фразы
- tags короткие, полезные для поиска
- не добавляй ничего кроме JSON
        `.trim();

        const upstream = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'http://localhost:3000',
            'X-OpenRouter-Title': 'Smart Notes'
          },
          body: JSON.stringify({
            model: MODEL,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: prompt }
            ],
            temperature: 0.3
          })
        });

        const data = await upstream.json();
        const text = data?.choices?.[0]?.message?.content || '';

        let parsed;
        try {
          parsed = extractJson(text);
        } catch {
          parsed = {
            summary: text.slice(0, 250) || 'Нет результата.',
            keywords: [],
            tags: []
          };
        }

        sendJson(res, 200, {
          summary: parsed.summary || '',
          keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
          tags: Array.isArray(parsed.tags) ? parsed.tags : [],
          raw: text
        });
      } catch (err) {
        sendJson(res, 500, {
          error: err.message,
          summary: 'AI недоступен.',
          keywords: [],
          tags: [],
          fallback: true
        });
      }
    });

    return;
  }

  let filePath = req.url === '/' ? 'index.html' : req.url.slice(1);
  filePath = path.join(__dirname, filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
