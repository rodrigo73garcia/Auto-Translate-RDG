// index.js (CommonJS) - Auto Translate RDG com LibreTranslate e 21 idiomas
const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const NodeCache = require('node-cache');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 8000;

// Diretório para subs geradas
const SUBS_DIR = path.join(__dirname, 'subs');
if (!fs.existsSync(SUBS_DIR)) fs.mkdirSync(SUBS_DIR, { recursive: true });

// Cache simples
const cache = new NodeCache({ stdTTL: 24 * 3600 }); // 24h

// Upstreams fixos (ordem de prioridade)
const DEFAULT_UPSTREAMS = [
  'https://opensubtitles.strem.io',
  'https://legendas.tv.strem.io'
];

// Lista de idiomas (21) incluindo pt-BR e pt-PT
const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'pt-PT', name: 'Português (Portugal)' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'ru', name: 'Русский' },
  { code: 'zh', name: '中文 (Chinese)' },
  { code: 'ja', name: '日本語 (Japanese)' },
  { code: 'ko', name: '한국어 (Korean)' },
  { code: 'ar', name: 'العربية (Arabic)' },
  { code: 'hi', name: 'हिन्दी (Hindi)' },
  { code: 'bn', name: 'বাংলা (Bengali)' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pl', name: 'Polski' },
  { code: 'uk', name: 'Українська (Ukrainian)' },
  { code: 'sv', name: 'Svenska' },
  { code: 'vi', name: 'Tiếng Việt' }
];

// ----------------- Utilitários -----------------
function safeFilename(s) {
  return String(s).replace(/[^a-z0-9-_.]/gi, '_');
}

function mapTargetToLibreCode(target) {
  // LibreTranslate expects 'pt' for Portuguese; map pt-BR / pt-PT => pt
  if (!target) return 'en';
  if (target.startsWith('pt')) return 'pt';
  // other codes mostly pass through (e.g. 'zh','ru','es'...)
  // normalize to first 2 letters for some locales (e.g., 'pt-BR' handled above)
  return target;
}

function parseAcceptLanguage(header) {
  if (!header) return 'en';
  const parts = header.split(',');
  if (!parts.length) return 'en';
  const first = parts[0].split(';')[0].trim(); // e.g. "pt-BR"
  const code = first.split('-')[0]; // 'pt'
  // try to match our LANGUAGES codes exactly first
  const exact = LANGUAGES.find(l => l.code.toLowerCase() === first.toLowerCase());
  if (exact) return exact.code;
  // else try base match
  const base = LANGUAGES.find(l => l.code.split('-')[0] === code);
  return base ? base.code : 'en';
}

// ----------------- LibreTranslate (Argos Open Tech) -----------------
const LIBRE_URL = process.env.LIBRE_URL || 'https://translate.argosopentech.com/translate';

async function libreTranslate(text, target) {
  if (!text || !text.trim()) return text;
  const t = mapTargetToLibreCode(target);
  const cacheKey = `libre:${t}:${text}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const resp = await axios.post(LIBRE_URL, {
      q: text,
      source: 'auto',
      target: t,
      format: 'text'
    }, { timeout: 20000 });
    if (resp && resp.data && (resp.data.translatedText || resp.data.translated_text)) {
      const translated = resp.data.translatedText || resp.data.translated_text;
      cache.set(cacheKey, translated);
      return translated;
    }
    // fallback: return original
    return text;
  } catch (e) {
    // console.warn('Libre translate error:', e.message);
    return text;
  }
}

// ----------------- Fetch subs from upstreams -----------------
async function fetchSubsFromUpstream(base, type, id) {
  try {
    const url = `${base.replace(/\/+$/, '')}/subtitles/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
    const resp = await axios.get(url, { timeout: 15000 });
    if (resp && resp.data && Array.isArray(resp.data.subtitles)) return resp.data.subtitles;
    return [];
  } catch (e) {
    // ignore and return empty
    return [];
  }
}

function pickEnglishOrFirst(subs) {
  if (!Array.isArray(subs) || !subs.length) return null;
  const en = subs.find(s => String(s.lang || '').toLowerCase().startsWith('en'));
  return en || subs[0];
}

// ----------------- SRT parsing/rendering (simple and robust) -----------------
function parseSubtitleToBlocks(content) {
  // Normalize line endings
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // If VTT header, remove it (we'll keep timestamps)
  const isVtt = normalized.trim().startsWith('WEBVTT');
  const text = isVtt ? normalized.replace(/^WEBVTT.*\n*/, '') : normalized;
  // Split blocks by double newline
  const rawBlocks = text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  const blocks = rawBlocks.map(b => {
    const lines = b.split('\n');
    let index = null;
    let time = null;
    // if first is index number
    if (lines[0] && /^\d+$/.test(lines[0].trim())) {
      index = lines.shift().trim();
    }
    // if next line has -->
    if (lines[0] && lines[0].includes('-->')) {
      time = lines.shift();
    }
    // remaining lines are text
    const textLines = lines;
    return { index, time, textLines, raw: b };
  });
  return { blocks, isVtt };
}

function renderBlocksToSrt(blocks) {
  const out = [];
  let counter = 1;
  for (const b of blocks) {
    const idx = b.index || String(counter);
    out.push(idx);
    out.push(b.time || '');
    if (Array.isArray(b.textLines) && b.textLines.length) {
      out.push(...b.textLines);
    } else {
      out.push('');
    }
    out.push(''); // blank
    counter++;
  }
  return out.join('\n').trim() + '\n';
}

// chunk helper for long texts (preserve line breaks)
function chunkStringPreserveLines(s, maxLen = 1600) {
  const parts = s.split('\n\n'); // paragraph blocks
  const out = [];
  let cur = '';
  for (const p of parts) {
    if (!cur) cur = p;
    else if ((cur + '\n\n' + p).length > maxLen) {
      out.push(cur);
      cur = p;
    } else {
      cur = cur + '\n\n' + p;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// Translate blocks (group lines inside block to reduce calls)
async function translateBlocks(blocks, target) {
  const out = [];
  for (const b of blocks) {
    if (!b.textLines || !b.textLines.length) {
      out.push(b);
      continue;
    }
    const original = b.textLines.join('\n');
    try {
      // if short, translate directly
      let translated;
      if (original.length <= 1800) {
        translated = await libreTranslate(original, target);
      } else {
        // chunk into pieces preserving paragraph breaks
        const pieces = chunkStringPreserveLines(original, 1600);
        const translatedPieces = [];
        for (const p of pieces) {
          const t = await libreTranslate(p, target);
          translatedPieces.push(t);
          // small delay to be gentler with service
          await new Promise(r => setTimeout(r, 60));
        }
        translated = translatedPieces.join('\n\n');
      }
      // re-split into lines similar to original
      const newLines = translated.split('\n').map(l => l.trim());
      b.textLines = newLines;
    } catch (e) {
      // on error fallback to original lines
    }
    out.push(b);
  }
  return out;
}

// ----------------- Routes -----------------

app.use('/subs', express.static(SUBS_DIR));

// manifest.json
app.get('/manifest.json', (req, res) => {
  const targetLang = req.query.targetLang || 'pt-BR';
  const base = getBaseUrl(req);
  res.json({
    id: 'org.auto.translate.rdg',
    version: '3.0.0',
    name: 'Auto Translate RDG',
    description: 'Addon que traduz legendas automaticamente',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
    config: [
      { key: 'targetLang', name: 'Idioma', type: 'select', options: LANGUAGES, default: targetLang }
      // note: we intentionally do not expose upstreams to user
    ],
    behaviorHints: { configurable: true, configurationRequired: false, config_url: base + '/configure' }
  });
});

// helper to build base URL
function getBaseUrl(req) {
  const env = process.env.PUBLIC_BASE_URL;
  if (env && env.trim()) return env.trim().replace(/\/+$/, '');
  const proto = req.protocol || 'http';
  const host = req.get('host') || ('localhost:' + PORT);
  return proto + '://' + host;
}

// configure page (multilanguage UI based on Accept-Language)
app.get('/configure', (req, res) => {
  const userLang = parseAcceptLanguage(req.headers['accept-language']);
  const selected = req.query.targetLang || userLang || 'pt-BR';

  const UI = {
    en: {
      title: 'Configure Auto-Translate RDG',
      langLabel: 'Target translation language:',
      button: 'Generate installation link',
      note: 'Upstreams: OpenSubtitles (preferred), then Legendas.tv (fallback)'
    },
    'pt-BR': {
      title: 'Configurar Auto-Translate RDG',
      langLabel: 'Idioma alvo da tradução:',
      button: 'Gerar link de instalação',
      note: 'Fontes: OpenSubtitles (preferencial), depois Legendas.tv (fallback)'
    },
    'pt-PT': {
      title: 'Configurar Auto-Translate RDG',
      langLabel: 'Idioma de destino da tradução:',
      button: 'Gerar link de instalação',
      note: 'Fontes: OpenSubtitles (preferencial), depois Legendas.tv (fallback)'
    },
    es: {
      title: 'Configurar Auto-Translate RDG',
      langLabel: 'Idioma destino de la traducción:',
      button: 'Generar enlace de instalación',
      note: 'Fuentes: OpenSubtitles (preferente), luego Legendas.tv (fallback)'
    },
    fr: {
      title: 'Configurer Auto-Translate RDG',
      langLabel: 'Langue cible :',
      button: 'Générer le lien d\'installation',
      note: 'Sources: OpenSubtitles (préféré), ensuite Legendas.tv (fallback)'
    }
  };

  // choose text set
  let t = UI[userLang] || UI['en'];
  // if userLang is pt-PT choose pt-PT
  if (userLang.startsWith('pt')) t = UI[userLang] || UI['pt-BR'] || UI['en'];

  const langOptions = LANGUAGES.map(l => `<option value="${l.code}" ${l.code === selected ? 'selected' : ''}>${l.name}</option>`).join('\n');

  const base = getBaseUrl(req);
  const html = `<!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(t.title)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: Arial, Helvetica, sans-serif; padding: 20px; max-width: 800px; margin: auto; }
      label { display:block; margin-top:12px; margin-bottom:6px; font-weight:600; }
      select, button { font-size:16px; padding:10px; width:100%; box-sizing:border-box; margin-bottom:12px; }
      .muted { color:#666; font-size:14px; margin-top:8px; }
      pre.link { background:#f7f7f7; padding:12px; border-radius:6px; word-break:break-all; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(t.title)}</h1>
    <form method="GET" action="/generate">
      <label>${escapeHtml(t.langLabel)}</label>
      <select name="targetLang">${langOptions}</select>
      <button type="submit">${escapeHtml(t.button)}</button>
    </form>
    <p class="muted">${escapeHtml(t.note)}</p>
    <hr/>
    <p>Base URL: <strong>${base}</strong></p>
  </body>
  </html>`;
  res.send(html);
});

// generate page -> shows manifest URL for installing in Stremio
app.get('/generate', (req, res) => {
  const target = req.query.targetLang || 'pt-BR';
  const manifestUrl = getBaseUrl(req) + '/manifest.json?targetLang=' + encodeURIComponent(target);
  const html = `<!doctype html>
  <html>
  <head><meta charset="utf-8"><title>Addon link</title><meta name="viewport" content="width=device-width, initial-scale=1"/></head>
  <body style="font-family:Arial;max-width:800px;margin:20px auto;padding:10px;">
    <h2>Addon link</h2>
    <p>Copy/install this link in Stremio:</p>
    <pre class="link" style="background:#f4f4f4;padding:12px;border-radius:6px;">${manifestUrl}</pre>
    <p><a href="/configure">Back to configure</a></p>
  </body></html>`;
  res.send(html);
});

// subtitle endpoint expected by Stremio
app.get('/subtitles/:type/:id.json', async (req, res) => {
  const { type, id } = req.params;
  const extra = req.query || {};
  // Stremio may pass targetLang via manifest query string if user selected in config
  const targetLang = extra.targetLang || extra.lang || 'pt-BR';
  const cacheKey = `subs_${type}_${id}_${targetLang}`;

  // cached response (sub metadata)
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ subtitles: [cached] });

  try {
    // iterate upstreams in order; pick first that returns >0 subtitles
    let foundList = [];
    let usedUpstream = null;
    for (const up of DEFAULT_UPSTREAMS) {
      const subs = await fetchSubsFromUpstream(up, type, id);
      if (Array.isArray(subs) && subs.length) {
        foundList = subs;
        usedUpstream = up;
        break;
      }
    }
    if (!foundList.length) {
      // nothing found
      return res.json({ subtitles: [] });
    }

    // prefer english
    const chosen = pickEnglishOrFirst(foundList);
    if (!chosen || !chosen.url) return res.json({ subtitles: [] });

    // download chosen subtitle file
    const resp = await axios.get(chosen.url, { responseType: 'arraybuffer', timeout: 20000 });
    let srtText = Buffer.from(resp.data).toString('utf8');
    // fallback to latin1 if many replacement chars
    if (srtText.includes('\ufffd')) srtText = Buffer.from(resp.data).toString('latin1');
    if (srtText.charCodeAt(0) === 0xFEFF) srtText = srtText.slice(1);

    // parse into blocks
    const parsed = parseSubtitleToBlocks(srtText);
    const blocks = parsed.blocks;

    // translate blocks
    const translatedBlocks = await translateBlocks(blocks, targetLang);

    // render back to SRT
    const outSrt = renderBlocksToSrt(translatedBlocks);

    // save file
    const fname = safeFilename(`${id}_${targetLang}.srt`);
    const fpath = path.join(SUBS_DIR, fname);
    fs.writeFileSync(fpath, outSrt, 'utf8');

    const subUrl = getBaseUrl(req) + '/subs/' + fname;
    const subMeta = {
      id: `${id}-${targetLang}`,
      lang: targetLang, // show chosen locale (e.g., pt-BR)
      name: `Auto Translate (${targetLang})`,
      url: subUrl,
      // optional: add extra fields if desired
      // author: 'Auto Translate RDG',
      // upsteam: usedUpstream
    };

    // cache metadata for some time to avoid reprocessing immediately
    cache.set(cacheKey, subMeta);
    return res.json({ subtitles: [subMeta] });
  } catch (e) {
    console.error('Error in /subtitles handler:', e && e.stack ? e.stack : e);
    return res.json({ subtitles: [] });
  }
});

// health
app.get('/health', (_, res) => res.json({ status: 'ok' }));

// helper: escape html
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, function (m) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m];
  });
}

app.listen(PORT, () => {
  console.log(`Auto-Translate-RDG rodando na porta ${PORT}`);
  console.log('Configure: ' + (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`) + '/configure');
});
