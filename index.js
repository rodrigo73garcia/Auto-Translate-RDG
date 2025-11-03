const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const axios = require('axios');
const translate = require('@vitalets/google-translate-api');
const NodeCache = require('node-cache');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 8000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

const SUBS_DIR = path.join(__dirname, 'subs');
if (!fs.existsSync(SUBS_DIR)) fs.mkdirSync(SUBS_DIR);

const CACHE_TTL_SEC = 60 * 60 * 24 * 7;
const cache = new NodeCache({ stdTTL: CACHE_TTL_SEC });

const TOP20 = [
  { name: 'Inglês - en', value: 'en' },
  { name: 'Chinês (Mandarim) - zh-CN', value: 'zh-CN' },
  { name: 'Hindi - hi', value: 'hi' },
  { name: 'Espanhol - es', value: 'es' },
  { name: 'Francês - fr', value: 'fr' },
  { name: 'Árabe - ar', value: 'ar' },
  { name: 'Bengali - bn', value: 'bn' },
  { name: 'Português (Brasil) - pt-BR', value: 'pt-BR' },
  { name: 'Russo - ru', value: 'ru' },
  { name: 'Urdu - ur', value: 'ur' },
  { name: 'Indonésio - id', value: 'id' },
  { name: 'Alemão - de', value: 'de' },
  { name: 'Japonês - ja', value: 'ja' },
  { name: 'Suaíli - sw', value: 'sw' },
  { name: 'Marati - mr', value: 'mr' },
  { name: 'Télugo - te', value: 'te' },
  { name: 'Turco - tr', value: 'tr' },
  { name: 'Tâmil - ta', value: 'ta' },
  { name: 'Italiano - it', value: 'it' },
  { name: 'Persa (Farsi) - fa', value: 'fa' }
];

function safeFilename(str) {
  return String(str).replace(/[^a-z0-9-_.]/gi, '_');
}

function parseUpstreams(input) {
  return String(input || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/\/+$/, ''));
}

function getConfiguredUpstreams(extraUpstreams) {
  const fromExtra = parseUpstreams(extraUpstreams);
  if (fromExtra.length) return fromExtra;
  const env = process.env.STREMIO_SUBS_BASES || 'https://opensubtitles-v3.stremio.online';
  return parseUpstreams(env);
}

async function fetchUpstreamSubtitles(type, id, upstreams) {
  const all = [];
  for (const base of upstreams) {
    const url = `${base}/subtitles/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
    try {
      const { data } = await axios.get(url, { timeout: 15000 });
      const arr = (data && data.subtitles) || [];
      for (const s of arr) all.push(s);
    } catch (_) {}
  }
  return all;
}

function pickPreferredEnglish(subs) {
  if (!subs || !subs.length) return null;
  const en = subs.find(s => (String(s.lang || '').toLowerCase()).startsWith('en'));
  return en || subs[0] || null;
}

async function downloadAsSrt(url) {
  const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 });
  return Buffer.from(resp.data).toString('utf8');
}

async function translateText(text, targetLang) {
  try {
    const res = await translate(text, { to: targetLang });
    return res.text;
  } catch {
    return text;
  }
}

app.use('/subs', express.static(SUBS_DIR));

app.get('/manifest.json', (req, res) => {
  const targetLang = req.query.targetLang || 'pt-BR';
  const upstreams = req.query.upstreams || '';
  
  res.json({
    id: 'org.auto.translate.rdg',
    version: '1.2.0',
    name: 'Auto Translate RDG',
    description: 'Subtitles-only: lê legendas de addons Stremio, prioriza EN, traduz e serve .srt no idioma escolhido.',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
    config: [
      {
        key: 'targetLang',
        name: 'Idioma alvo das legendas',
        type: 'select',
        options: TOP20,
        default: targetLang
      },
      {
        key: 'upstreams',
        name: 'Base URLs de addons de legendas (separadas por vírgula)',
        type: 'text',
        default: upstreams
      }
    ],
    behaviorHints: { config_url: `${PUBLIC_BASE_URL}/configure` }
  });
});

app.get('/subtitles/:type/:id.json', async (req, res) => {
  const { type, id } = req.params;
  const targetLang = req.query.targetLang || 'pt-BR';
  const upstreams = getConfiguredUpstreams(req.query.upstreams);
  
  const cacheKey = `${type}_${id}_${targetLang}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ subtitles: [cached] });

  try {
    if (!upstreams.length) return res.json({ subtitles: [] });
    
    const list = await fetchUpstreamSubtitles(type, id, upstreams);
    const chosen = pickPreferredEnglish(list);
    if (!chosen || !chosen.url) return res.json({ subtitles: [] });

    const srtText = await downloadAsSrt(chosen.url);
    const lines = srtText.split('\n');
    const translated = [];
    
    for (const line of lines) {
      if (/^\d+$/.test(line) || line.includes('-->') || line.trim() === '') {
        translated.push(line);
      } else {
        const trans = await translateText(line, targetLang);
        translated.push(trans);
      }
    }

    const fname = safeFilename(`${id}_${targetLang}.srt`);
    const fpath = path.join(SUBS_DIR, fname);
    fs.writeFileSync(fpath, translated.join('\n'), 'utf8');

    const url = `${PUBLIC_BASE_URL}/subs/${fname}`;
    const subObj = { id: `${id}-${targetLang}-rdg`, lang: targetLang, url };
    cache.set(cacheKey, subObj);
    
    res.json({ subtitles: [subObj] });
  } catch (e) {
    res.json({ subtitles: [] });
  }
});

app.get('/configure', (req, res) => {
  const targetLang = req.query.targetLang || 'pt-BR';
  const upstreams = req.query.upstreams || '';

  const optionsHtml = TOP20.map(opt => {
    const sel = opt.value === targetLang ? 'selected' : '';
    return `<option ${sel} value="${opt.value}">${opt.name}</option>`;
  }).join('');

  const installUrl = `${PUBLIC_BASE_URL}/manifest.json?targetLang=${encodeURIComponent(targetLang)}&upstreams=${encodeURIComponent(upstreams)}`;
  const html = `
    <html><head><meta charset="utf-8"><title>Auto Translate RDG</title></head>
    <body style="font-family: system-ui, sans-serif; padding: 24px; max-width: 880px;">
      <h2>Auto Translate RDG</h2>
      <form method="GET" action="/configure" style="margin-bottom:16px">
        <label>Idioma alvo:&nbsp;</label>
        <select name="targetLang">${optionsHtml}</select>
        <br/><br/>
        <label>Upstreams (URLs de addons de legendas, separadas por vírgula):</label><br/>
        <input style="width:100%" type="text" name="upstreams" placeholder="https://addon1.xyz, https://addon2.xyz" value="${upstreams}"/>
        <br/><br/>
        <button type="submit">Gerar link de instalação</button>
      </form>
      <p>Instalar no Stremio:</p>
      <pre style="white-space:pre-wrap; background:#f7f7f7; padding:12px; border-radius:8px">${installUrl}</pre>
    </body></html>
  `;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Auto Translate RDG rodando na porta ${PORT}`);
  console.log(`Página de configuração: ${PUBLIC_BASE_URL}/configure`);
});
