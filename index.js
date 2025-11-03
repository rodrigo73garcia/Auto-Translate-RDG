const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { addonBuilder } = require('stremio-addon-client');
const axios = require('axios');
const translate = require('@vitalets/google-translate-api');
const NodeCache = require('node-cache');
const { default: SrtParser } = require('srt-parser-2');
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
const parser = new SrtParser();

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

function vttToSrt(vtt) {
  let text = String(vtt).replace(/\r/g, '');
  text = text.replace(/^\uFEFF?WEBVTT[^\n]*\n+/i, '');
  text = text.replace(/(^|\n)NOTE[^\n]*\n[\s\S]*?(?=\n\n|$)/gi, '$1');
  text = text
    .replace(/(\d{2}):(\d{2})\.(\d{3})/g, '00:$1:$2,$3')
    .replace(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})/g, '$1:$2:$3,$4');
  const blocks = text.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  const srtBlocks = blocks.map((b, i) => {
    const lines = b.split('\n');
    return /^\d+$/.test(lines[0]) ? b : `${i + 1}\n${b}`;
  });
  return srtBlocks.join('\n\n');
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
  const buf = Buffer.from(resp.data);
  const head = buf.slice(0, 16).toString('utf8');
  const txt = buf.toString('utf8');
  if (/WEBVTT/i.test(head) || /^WEBVTT/i.test(txt)) {
    return vttToSrt(txt);
  }
  return txt;
}

async function translateSrtText(srtText, targetLang) {
  let data;
  try {
    data = parser.fromSrt(srtText);
  } catch (_) {
    const lines = srtText.split('\n');
    const out = [];
    for (const line of lines) {
      if (/^\d+$/.test(line) || line.includes('-->') || line.trim() === '') out.push(line);
      else {
        try {
          const res = await translate(line, { to: targetLang });
          out.push(res.text);
        } catch {
          out.push(line);
        }
      }
    }
    return out.join('\n');
  }

  const BATCH_SIZE = 20;
  const blocks = data.map(it => it.text.replace(/\r/g, '').split('\n').join(' '));
  const translated = [];
  for (let i = 0; i < blocks.length; i += BATCH_SIZE) {
    const slice = blocks.slice(i, i + BATCH_SIZE);
    const big = slice.join('\n\n');
    try {
      const res = await translate(big, { to: targetLang });
      const parts = res.text.split('\n\n');
      if (parts.length === slice.length) translated.push(...parts);
      else {
        const lines = res.text.split('\n');
        for (let j = 0; j < slice.length; j++) translated.push(lines[j] || slice[j]);
      }
    } catch {
      translated.push(...slice);
    }
  }
  const newItems = data.map((item, idx) => ({ ...item, text: translated[idx] || item.text }));
  return parser.toSrt(newItems);
}

function makeManifest(targetLang = 'pt-BR', upstreamsDefault = '') {
  return {
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
        default: upstreamsDefault
      }
    ],
    behaviorHints: { config_url: `${PUBLIC_BASE_URL}/configure` }
  };
}

const defaultManifest = makeManifest('pt-BR', '');
const builder = new addonBuilder(defaultManifest);

builder.defineSubtitleHandler(({ type, id, extra }, cb) => {
  const requestedLang = (extra && (extra.lang || extra.targetLang)) || 'pt-BR';
  const upstreams = getConfiguredUpstreams(extra && extra.upstreams);
  const cacheKey = `${type}_${id}_${requestedLang}_${upstreams.join('|')}`;
  const cached = cache.get(cacheKey);
  if (cached) return cb(null, { subtitles: [cached] });

  (async () => {
    try {
      if (!upstreams.length) return cb(null, { subtitles: [] });
      const list = await fetchUpstreamSubtitles(type, id, upstreams);
      const chosen = pickPreferredEnglish(list);
      if (!chosen || !chosen.url) return cb(null, { subtitles: [] });

      const originalSrt = await downloadAsSrt(chosen.url);
      const translated = await translateSrtText(originalSrt, requestedLang);

      const fname = safeFilename(`${id}_${requestedLang}.srt`);
      const fpath = path.join(SUBS_DIR, fname);
      fs.writeFileSync(fpath, translated, 'utf8');

      const url = `${PUBLIC_BASE_URL}/subs/${fname}`;
      const subObj = { id: `${id}-${requestedLang}-rdg`, lang: requestedLang, url };
      cache.set(cacheKey, subObj);
      return cb(null, { subtitles: [subObj] });
    } catch (_) {
      return cb(null, { subtitles: [] });
    }
  })();
});

app.use('/subs', express.static(SUBS_DIR));

app.get('/manifest.json', (req, res) => {
  const targetLang = req.query.targetLang || 'pt-BR';
  const upstreams = req.query.upstreams || '';
  const manifest = makeManifest(targetLang, upstreams);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(manifest);
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
    <html><head><meta charset="utf-8"><title>Auto Translate RDG - Configurar</title></head>
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
      <p>Instalar no Stremio usando o manifest:</p>
      <pre style="white-space:pre-wrap; background:#f7f7f7; padding:12px; border-radius:8px">${installUrl}</pre>
      <p>Copie a URL acima e cole em Meus Addons → Adicionar manualmente no Stremio.</p>
      <p><a href="${installUrl}">Abrir manifest.json</a></p>
    </body></html>
  `;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/', builder.getRouter());

app.listen(PORT, () => {
  console.log(`Auto Translate RDG rodando na porta ${PORT}`);
  console.log(`Página de configuração: ${PUBLIC_BASE_URL}/configure`);
});
