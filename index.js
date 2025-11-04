// index.js (refatorado) - substitua o arquivo atual por este
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const axios = require('axios');
const translate = require('@vitalets/google-translate-api');
const NodeCache = require('node-cache');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 8000;

function getBaseUrl(req) {
  const env = process.env.PUBLIC_BASE_URL;
  if (env && env.trim()) return env.trim().replace(/\/+$/, '');
  const proto = req.protocol || 'http';
  const host = req.get('host') || ('localhost:' + PORT);
  return proto + '://' + host;
}

const SUBS_DIR = path.join(__dirname, 'subs');
if (!fs.existsSync(SUBS_DIR)) fs.mkdirSync(SUBS_DIR, { recursive: true });
const cache = new NodeCache({ stdTTL: 7 * 24 * 3600 }); // 7 dias

const LANGS = [
  { name: 'Português (Brasil)', value: 'pt' },
  { name: 'Inglês', value: 'en' },
  { name: 'Espanhol', value: 'es' },
  { name: 'Francês', value: 'fr' }
];

function safe(str) {
  return String(str).replace(/[^a-z0-9-_.]/gi, '_');
}

function parseUpstreams(input) {
  return String(input || '').split(',').map(s => s.trim()).filter(Boolean).map(s => s.replace(/\/+$/, ''));
}

function getUpstreams(extra) {
  const arr = parseUpstreams(extra);
  if (arr.length) return arr;
  return parseUpstreams(process.env.STREMIO_SUBS_BASES || 'https://opensubtitles-v3.stremio.online');
}

async function fetchSubs(type, id, upstreams) {
  const all = [];
  for (const base of upstreams) {
    try {
      const url = base + '/subtitles/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '.json';
      const resp = await axios.get(url, { timeout: 15000 });
      const arr = resp.data && resp.data.subtitles || [];
      all.push(...arr);
    } catch (e) {
      console.warn('fetchSubs error for', base, e.message);
    }
  }
  return all;
}

function pickSource(subs) {
  if (!subs || !subs.length) return null;
  // prefer english source if exists, otherwise prefer original language or first
  let en = subs.find(s => String(s.lang || '').toLowerCase().startsWith('en'));
  if (en) return en;
  return subs[0];
}

async function downloadRaw(url) {
  // try utf8, fallback latin1
  try {
    const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 });
    const buf = Buffer.from(resp.data);
    // try utf8
    let text = buf.toString('utf8');
    // heuristic: if replacement char present a lot, fallback
    if (text.includes('\ufffd')) {
      text = buf.toString('latin1');
    }
    // strip BOM
    if (text.charCodeAt(0) === 0xFEFF) {
      text = text.slice(1);
    }
    return text;
  } catch (e) {
    throw e;
  }
}

// parse SRT/VTT into blocks [{index, time, textLines:[] , raw}]
function parseSub(content) {
  const isVtt = content.trim().startsWith('WEBVTT');
  // normalize CRLF
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // split in blocks by double newlines (works for most SRT)
  const parts = normalized.split(/\n{2,}/g).map(p => p.trim()).filter(Boolean);
  const blocks = [];
  for (const p of parts) {
    const lines = p.split('\n');
    if (lines.length === 0) continue;
    // typical SRT: index / time / text...
    let idx = null, time = null, textLines = [];
    if (/^\d+$/.test(lines[0])) {
      idx = lines.shift();
    }
    if (lines.length && lines[0].includes('-->')) {
      time = lines.shift();
    } else if (isVtt && lines[0].includes('-->')) {
      time = lines.shift();
    }
    textLines = lines;
    blocks.push({ index: idx, time: time, textLines, raw: p });
  }
  return { isVtt, blocks };
}

// join text lines, translate, and reassemble preserving time/index
async function translateBlocks(blocks, targetLang) {
  // translate sequentially to simplify rate-limit and to preserve order
  const outBlocks = [];
  for (const b of blocks) {
    if (!b.textLines || !b.textLines.length) {
      outBlocks.push(b);
      continue;
    }
    const originalText = b.textLines.join('\n');
    // quick heuristic: skip translation if already in targetLang? (not reliable) -> skip
    let translated = originalText;
    try {
      // chunk if very big (safe size ~2000 chars)
      if (originalText.length <= 2000) {
        const res = await translateWithRetry(originalText, targetLang);
        translated = res;
      } else {
        // split into smaller chunks on paragraph boundaries
        const pieces = chunkStringPreservingLines(originalText, 1800);
        const translatedPieces = [];
        for (const pc of pieces) {
          const res = await translateWithRetry(pc, targetLang);
          translatedPieces.push(res);
          // small delay to be gentler with rate-limits
          await tinySleep(60);
        }
        translated = translatedPieces.join('\n');
      }
      // re-split into lines similar to original (rough)
      const newLines = translated.split('\n').map(l => l.trim());
      b.textLines = newLines;
    } catch (e) {
      console.warn('translateBlocks error, using original text fallback:', e.message);
      // keep original
    }
    outBlocks.push(b);
  }
  return outBlocks;
}

function chunkStringPreservingLines(s, maxLen) {
  const paragraphs = s.split('\n');
  const out = [];
  let cur = '';
  for (const p of paragraphs) {
    if ((cur + '\n' + p).length > maxLen && cur) {
      out.push(cur.trim());
      cur = p;
    } else {
      cur = cur ? (cur + '\n' + p) : p;
    }
  }
  if (cur) out.push(cur.trim());
  return out;
}

async function translateWithRetry(text, targetLang, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await translate(text, { to: targetLang });
      if (r && r.text) return r.text;
    } catch (e) {
      if (i === tries - 1) throw e;
      await tinySleep(200);
    }
  }
  return text;
}

function tinySleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function renderSrt(blocks) {
  // render back to srt-like format
  const lines = [];
  let counter = 1;
  for (const b of blocks) {
    if (b.index) {
      lines.push(b.index);
    } else {
      lines.push(String(counter));
    }
    if (b.time) {
      lines.push(b.time);
    } else {
      lines.push('');
    }
    if (b.textLines && b.textLines.length) {
      lines.push(...b.textLines);
    } else {
      lines.push('');
    }
    lines.push(''); // blank line
    counter++;
  }
  return lines.join('\n').trim() + '\n';
}

function parseExtra(req) {
  let extra = {};
  if (req.query && req.query.extra) {
    try { extra = JSON.parse(req.query.extra); } catch (e) {}
  }
  if (!Object.keys(extra).length && req.params && req.params.extra) {
    try { extra = JSON.parse(decodeURIComponent(req.params.extra)); } catch (e) {}
  }
  return extra;
}

app.use('/subs', express.static(SUBS_DIR, { extensions: ['srt'] }));

app.get('/manifest.json', (req, res) => {
  const base = getBaseUrl(req);
  const lang = req.query.targetLang || 'pt';
  const ups = req.query.upstreams || '';
  res.json({
    id: 'org.auto.translate.rdg',
    version: '1.4.0',
    name: 'Auto Translate RDG',
    description: 'Legendas traduzidas automaticamente',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
    config: [
      { key: 'targetLang', name: 'Idioma', type: 'select', options: LANGS, default: lang },
      { key: 'upstreams', name: 'Upstreams CSV', type: 'text', default: ups }
    ],
    behaviorHints: { configurable: true, configurationRequired: false, config_url: base + '/configure' }
  });
});

app.get('/subtitles/:type/:id/:extra.json', handler);
app.get('/subtitles/:type/:id.json', handler);

async function handler(req, res) {
  const base = getBaseUrl(req);
  const { type, id } = req.params;
  const extra = parseExtra(req);
  const lang = extra.targetLang || extra.lang || req.query.targetLang || 'pt';
  const ups = getUpstreams(extra.upstreams || req.query.upstreams);
  const key = type + '_' + id + '_' + lang + '_' + ups.join('|');
  try {
    const cached = cache.get(key);
    if (cached) return res.json({ subtitles: [cached] });
    if (!ups.length) return res.json({ subtitles: [] });

    const list = await fetchSubs(type, id, ups);
    const chosen = pickSource(list);
    if (!chosen || !chosen.url) return res.json({ subtitles: [] });

    const raw = await downloadRaw(chosen.url);
    const parsed = parseSub(raw);
    const blocks = parsed.blocks;
    const translatedBlocks = await translateBlocks(blocks, lang);
    const outSrt = renderSrt(translatedBlocks);

    const fname = safe(id + '_' + lang + '.srt');
    const fpath = path.join(SUBS_DIR, fname);
    fs.writeFileSync(fpath, outSrt, 'utf8');

    const url = base + '/subs/' + fname;
    const sub = { id: id + '-' + lang, lang: lang, url: url };
    cache.set(key, sub);
    return res.json({ subtitles: [sub] });
  } catch (e) {
    console.error('handler error', e && e.stack ? e.stack : e);
    return res.json({ subtitles: [] });
  }
}

app.get('/configure', (req, res) => {
  const base = getBaseUrl(req);
  const lang = req.query.targetLang || 'pt';
  const ups = req.query.upstreams || '';
  const opts = LANGS.map(o => '<option ' + (o.value === lang ? 'selected' : '') + ' value="' + o.value + '">' + o.name + '</option>').join('');
  const url = base + '/manifest.json?targetLang=' + encodeURIComponent(lang) + '&upstreams=' + encodeURIComponent(ups);
  const html = '<html><head><meta charset="utf-8"><title>Auto Translate RDG</title></head><body style="font-family:sans-serif;padding:24px;max-width:880px"><h2>Auto Translate RDG</h2><form method="GET" action="/configure"><label>Idioma:</label><select name="targetLang">' + opts + '</select><br/><br/><label>Upstreams CSV:</label><br/><input style="width:100%" type="text" name="upstreams" value="' + ups + '"/><br/><br/><button>Gerar</button></form><p>Link:</p><pre style="background:#f7f7f7;padding:12px">' + url + '</pre><p><a href="' + url + '">Abrir</a></p></body></html>';
  res.send(html);
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  const base = process.env.PUBLIC_BASE_URL || ('http://localhost:' + PORT);
  console.log('Rodando na porta ' + PORT);
  console.log('Config: ' + base + '/configure');
});
