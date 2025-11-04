// index.js (FINAL) - Auto Translate RDG (debug logs)
// Requires Node >=18, package.json: type:"module"
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import NodeCache from "node-cache";
import crypto from "crypto";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const LIBRETRANSLATE_API = (process.env.LIBRETRANSLATE_API || 'https://libretranslate.com').replace(/\/+$/, '');

const SUBS_DIR = path.join(process.cwd(), 'subs');
if (!fs.existsSync(SUBS_DIR)) fs.mkdirSync(SUBS_DIR, { recursive: true });

// Cache: avoid re-traduzir a mesma legenda repetidas vezes
// Key example: cacheKey = `${imdbId}:${subtitleId}:${targetLang}`
const cache = new NodeCache({ stdTTL: 24 * 3600, checkperiod: 120 }); // 24h ttl

// ---------------- Languages (21) - include pt-BR and pt-PT adjacent ----------------
const LANG_OPTIONS = [
  { code: 'zh', label: 'Chinese (中文)' },
  { code: 'es', label: 'Spanish (Español)' },
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'Hindi (हिन्दी)' },
  { code: 'ar', label: 'Arabic (العربية)' },
  { code: 'bn', label: 'Bengali (বাংলা)' },
  { code: 'pt-BR', label: 'Portuguese (Brasil)' },
  { code: 'ru', label: 'Russian (Русский)' },
  { code: 'ja', label: 'Japanese (日本語)' },
  { code: 'pa', label: 'Punjabi (ਪੰਜਾਬੀ)' },
  { code: 'de', label: 'German (Deutsch)' },
  { code: 'fr', label: 'French (Français)' },
  { code: 'id', label: 'Indonesian (Bahasa Indonesia)' },
  { code: 'ur', label: 'Urdu (اردو)' },
  { code: 'it', label: 'Italian (Italiano)' },
  { code: 'ko', label: 'Korean (한국어)' },
  { code: 'vi', label: 'Vietnamese (Tiếng Việt)' },
  { code: 'ta', label: 'Tamil (தமிழ்)' },
  { code: 'tr', label: 'Turkish (Türkçe)' },
  { code: 'fa', label: 'Persian (فارسی)' },
  { code: 'pt-PT', label: 'Portuguese (Portugal)' }
];

// Helper map for display name by code
const LANG_MAP = {};
for (const l of LANG_OPTIONS) LANG_MAP[l.code] = l.label;

// ---------------- Helpers ----------------
function logDebug(...args) { console.log('[DEBUG]', ...args); }
function logInfo(...args) { console.log(...args); }
function logWarn(...args) { console.warn(...args); }
function logError(...args) { console.error(...args); }

function safeFilename(s) {
  return String(s).replace(/[^a-z0-9-_.]/gi, '_');
}

function sha1(input) {
  return crypto.createHash('sha1').update(input).digest('hex');
}

function mapTargetForLibre(code) {
  // LibreTranslate expects 'pt' for Portuguese (map pt-BR / pt-PT to 'pt')
  if (!code) return 'en';
  if (code.startsWith('pt')) return 'pt';
  // Libre uses 'zh' 'en' etc. For codes like 'pa' or 'bn', they may or may not be supported;
  // we still pass them — LibreTranslate will fallback or error, but we keep mapping simple.
  return code;
}

async function timeoutPromise(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------- OpenSubtitles REST fetch ----------------
// Use the public REST search: https://rest.opensubtitles.org/search/imdbid-XXXX
async function fetchOpenSubtitlesList(imdbId) {
  const imdbNum = imdbId.replace(/^tt/, '');
  const url = `https://rest.opensubtitles.org/search/imdbid-${imdbNum}`;
  logInfo('🔍 Fetching OpenSubtitles list:', url);
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'AutoTranslate-RDG/1.0' },
      timeout: 20000
    });
    if (!resp.ok) {
      logWarn('⚠️ OpenSubtitles list HTTP', resp.status);
      return [];
    }
    const json = await resp.json();
    if (!Array.isArray(json)) return [];
    logInfo(`✅ OpenSubtitles returned ${json.length} items`);
    return json;
  } catch (e) {
    logWarn('❌ Failed fetching OpenSubtitles list:', e.message);
    return [];
  }
}

// Download subtitle file (may be gz). Return string content (utf8)
async function downloadSubtitleRaw(url) {
  logInfo('⚙️ Downloading subtitle from:', url);
  try {
    const resp = await fetch(url, { timeout: 20000 });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    // check if gz by magic bytes
    if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
      logInfo('🗜️ .gz detected, decompressing...');
      const decompressed = zlib.gunzipSync(buffer);
      let text = decompressed.toString('utf8');
      // fallback latin1 if weird replacement characters
      if (text.includes('\ufffd')) text = decompressed.toString('latin1');
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      return text;
    } else {
      let text = buffer.toString('utf8');
      if (text.includes('\ufffd')) text = buffer.toString('latin1');
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      return text;
    }
  } catch (e) {
    logWarn('❌ Failed to download subtitle:', e.message);
    throw e;
  }
}

// ---------------- SRT parsing & rendering ----------------
function parseSrtToBlocks(content) {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawBlocks = normalized.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  const blocks = rawBlocks.map(b => {
    const lines = b.split('\n');
    let idx = null, time = null;
    if (/^\d+$/.test(lines[0].trim())) {
      idx = lines.shift().trim();
    }
    if (lines[0] && lines[0].includes('-->')) {
      time = lines.shift();
    }
    const textLines = lines;
    return { index: idx, time, textLines };
  });
  return blocks;
}

function renderBlocksToSrt(blocks) {
  const out = [];
  let counter = 1;
  for (const b of blocks) {
    out.push(b.index || String(counter));
    out.push(b.time || '');
    out.push(...(b.textLines || ['']));
    out.push('');
    counter++;
  }
  return out.join('\n').trim() + '\n';
}

// chunk preserve paragraphs
function chunkStringPreserveLines(s, maxLen = 1500) {
  const paragraphs = s.split('\n\n');
  const out = [];
  let cur = '';
  for (const p of paragraphs) {
    if (!cur) cur = p;
    else if ((cur + '\n\n' + p).length > maxLen) {
      out.push(cur);
      cur = p;
    } else cur = cur + '\n\n' + p;
  }
  if (cur) out.push(cur);
  return out;
}

// Translate via LibreTranslate with retries
async function libreTranslateText(text, target, tries = 2) {
  const t = mapTargetForLibre(target);
  const cacheKey = `lt:${t}:${text}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    logDebug('🔁 LibreTranslate cache hit');
    return cached;
  }
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await fetch(`${LIBRETRANSLATE_API}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: text, source: 'auto', target: t, format: 'text' }),
        timeout: 20000
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      const translated = json.translatedText || json.translated_text || text;
      cache.set(cacheKey, translated);
      // small politeness
      await timeoutPromise(40);
      return translated;
    } catch (e) {
      logWarn('⚠️ LibreTranslate attempt', i + 1, 'failed:', e.message);
      if (i < tries - 1) await timeoutPromise(200);
    }
  }
  return text;
}

// Translate blocks intelligently (grouped)
async function translateBlocks(blocks, target) {
  const out = [];
  for (const b of blocks) {
    if (!b.textLines || !b.textLines.length) { out.push(b); continue; }
    const original = b.textLines.join('\n');
    try {
      let translated;
      if (original.length <= 1400) {
        translated = await libreTranslateText(original, target);
      } else {
        const parts = chunkStringPreserveLines(original, 1200);
        const translatedParts = [];
        for (const p of parts) {
          translatedParts.push(await libreTranslateText(p, target));
        }
        translated = translatedParts.join('\n\n');
      }
      // break into lines similar to original
      b.textLines = translated.split('\n').map(l => l.trim());
    } catch (e) {
      logWarn('⚠️ Block translation error, using original:', e.message);
    }
    out.push(b);
  }
  return out;
}

// ---------------- Main flow: pick best subtitle from OpenSubtitles list ----------------
function pickBestSubtitleFromList(list) {
  if (!Array.isArray(list) || !list.length) return null;
  // prefer iso639 === 'eng' or 'en'
  const en = list.find(s => (s.iso639 && s.iso639.toLowerCase().startsWith('en')) || (s.language && String(s.language).toLowerCase().startsWith('en')));
  if (en) return en;
  // else try iso639 'eng'
  const eng = list.find(s => String(s.iso639 || '').toLowerCase() === 'eng');
  if (eng) return eng;
  // else first
  return list[0];
}

// ---------------- Stremio endpoints ----------------

// Serve subs folder statically
app.use('/subs', express.static(SUBS_DIR));

// manifest.json served to Stremio
app.get('/manifest.json', (req, res) => {
  const defaultLang = req.query.targetLang || 'pt-BR';
  const configOptions = LANG_OPTIONS.map(l => ({ key: l.code, name: l.label })).map((o, i) => null); // not used directly by Stremio UI here
  // manifest with config for targetLang selection (Stremio expects config array)
  res.json({
    id: 'org.auto.translate.rdg',
    version: '1.0.0',
    name: 'Auto Translate RDG',
    description: 'Addon que traduz automaticamente legendas (LibreTranslate).',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
    config: [
      { key: 'targetLang', name: 'Target language', type: 'select', options: LANG_OPTIONS, default: defaultLang }
    ],
    behaviorHints: { configurable: true, configurationRequired: false, config_url: PUBLIC_BASE_URL + '/configure' }
  });
});

// Configuration UI (multilingual)
function detectUiLang(req) {
  const accepted = req.acceptsLanguages(['pt-BR','pt','en','es','fr','de']) || 'en';
  // normalize to two letter except pt-BR
  if (accepted === 'pt-BR') return 'pt-BR';
  if (accepted.startsWith('pt')) return 'pt-BR';
  return accepted.split('-')[0];
}

const UI_TEXTS = {
  'en': {
    title: 'Auto Translate RDG - Configuration',
    descr: 'Select the target language and generate the installation link for Stremio.',
    langLabel: 'Target translation language',
    button: 'Generate installation link',
    copy: 'Copy',
    install: 'Install'
  },
  'pt-BR': {
    title: 'Auto Translate RDG - Configuração',
    descr: 'Selecione o idioma alvo e gere o link de instalação para o Stremio.',
    langLabel: 'Idioma alvo',
    button: 'Gerar link de instalação',
    copy: 'Copiar',
    install: 'Instalar'
  },
  'es': {
    title: 'Auto Translate RDG - Configuración',
    descr: 'Seleccione el idioma de destino y genere el enlace de instalación para Stremio.',
    langLabel: 'Idioma de destino',
    button: 'Generar enlace de instalación',
    copy: 'Copiar',
    install: 'Instalar'
  },
  'fr': {
    title: 'Auto Translate RDG - Configuration',
    descr: 'Sélectionnez la langue cible et générez le lien d\'installation pour Stremio.',
    langLabel: 'Langue cible',
    button: 'Générer le lien d\'installation',
    copy: 'Copier',
    install: 'Installer'
  },
  'de': {
    title: 'Auto Translate RDG - Konfiguration',
    descr: 'Wählen Sie die Zielsprache und erstellen Sie den Installationslink für Stremio.',
    langLabel: 'Zielsprache',
    button: 'Installationslink generieren',
    copy: 'Kopieren',
    install: 'Installieren'
  }
};

app.get('/configure', (req, res) => {
  const uiLang = detectUiLang(req);
  const T = UI_TEXTS[uiLang] || UI_TEXTS['en'];
  const targetDefault = req.query.targetLang || 'pt-BR';
  const optionsHtml = LANG_OPTIONS.map(l => `<option value="${l.code}" ${l.code === targetDefault ? 'selected' : ''}>${l.label}</option>`).join('\n');

  const html = `<!doctype html>
<html lang="${uiLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(T.title)}</title>
  <style>
    body{font-family:Inter,Arial,Helvetica,sans-serif;max-width:900px;margin:28px auto;padding:20px}
    h1{margin-bottom:6px}
    label{display:block;margin-top:12px;font-weight:600}
    select,button{padding:10px;font-size:16px;border-radius:8px;border:1px solid #ddd;width:100%;box-sizing:border-box}
    button{background:#0b74de;color:#fff;border:none;margin-top:12px;cursor:pointer}
    .small{font-size:13px;color:#666;margin-top:8px}
    pre{background:#f7f7f7;padding:10px;border-radius:6px;word-break:break-all}
    .controls{display:flex;gap:8px;margin-top:10px}
    .controls button{flex:1}
  </style>
</head>
<body>
  <h1>${escapeHtml(T.title)}</h1>
  <p class="small">${escapeHtml(T.descr)}</p>

  <form id="frm" onsubmit="return false">
    <label>${escapeHtml(T.langLabel)}</label>
    <select id="target">${optionsHtml}</select>
    <div class="controls">
      <button id="gen">${escapeHtml(T.button)}</button>
      <button id="copy" style="background:#6c757d">${escapeHtml(T.copy)}</button>
      <button id="install" style="background:#28a745">${escapeHtml(T.install)}</button>
    </div>
  </form>

  <div style="margin-top:14px">
    <label>Installation link</label>
    <pre id="manifestLink">-</pre>
  </div>

  <script>
    const PUBLIC_BASE = ${JSON.stringify(PUBLIC_BASE_URL)};
    const genBtn = document.getElementById('gen');
    const copyBtn = document.getElementById('copy');
    const installBtn = document.getElementById('install');
    const sel = document.getElementById('target');
    const out = document.getElementById('manifestLink');

    function buildManifestLink(lang) {
      return PUBLIC_BASE + '/manifest.json?targetLang=' + encodeURIComponent(lang);
    }

    genBtn.addEventListener('click', () => {
      const lang = sel.value;
      const url = buildManifestLink(lang);
      out.textContent = url;
    });

    copyBtn.addEventListener('click', async () => {
      const txt = out.textContent;
      try {
        await navigator.clipboard.writeText(txt);
        copyBtn.textContent = 'Copied';
        setTimeout(()=>copyBtn.textContent='${escapeJs(T.copy)}',1200);
      } catch(e) {
        alert('Copy failed: ' + e);
      }
    });

    installBtn.addEventListener('click', () => {
      const url = buildManifestLink(sel.value);
      // Stremio deep link pattern (works on mobile/desktop when stremio handler exists)
      const deep = 'stremio://' + url;
      // open deep link
      window.location.href = deep;
    });

    // auto-generate default on load
    out.textContent = buildManifestLink(sel.value);
  </script>
</body>
</html>`;

  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.send(html);
});

// ---------------- Subtitle handler expected by Stremio ----------------
// Route: /subtitles/:type/:imdbId.json
app.get('/subtitles/:type/:imdbId.json', async (req, res) => {
  const startTs = Date.now();
  const { type, imdbId } = req.params;
  const targetLang = req.query.targetLang || req.query.lang || 'pt-BR';
  logInfo(`🎬 Requested subtitles for ${imdbId} (type=${type}) → target ${targetLang}`);

  try {
    // 1) fetch list from OpenSubtitles
    const list = await fetchOpenSubtitlesList(imdbId);
    if (!list || !list.length) {
      logWarn('🚫 No subtitles found on OpenSubtitles list');
      return res.json({ subtitles: [] });
    }

    // 2) pick best (prefer english)
    const chosenMeta = pickBestSubtitleFromList(list);
    if (!chosenMeta) {
      logWarn('🚫 No suitable subtitle metadata found');
      return res.json({ subtitles: [] });
    }
    logInfo('🔎 Chosen subtitle meta:', { id: chosenMeta.IDSubtitleFile || chosenMeta.IDSubtitle, lang: chosenMeta.iso639 || chosenMeta.language });

    // build cache key by original subtitle id + imdb + targetLang
    const originalId = chosenMeta.IDSubtitleFile || chosenMeta.IDSubtitle || (chosenMeta.SubFileName || sha1(JSON.stringify(chosenMeta)));
    const cacheKey = `subs:${imdbId}:${originalId}:${targetLang}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      logInfo('🔁 Serving from cache:', cached.file);
      const fileUrl = PUBLIC_BASE_URL + '/subs/' + path.basename(cached.file);
      const name = `${LANG_MAP[targetLang] || targetLang} _ Auto Translate RDG`;
      return res.json({ subtitles: [{ id: cacheKey, lang: targetLang, name: name, url: fileUrl }] });
    }

    // 3) download chosen subtitle file (SubDownloadLink or SubDownloadLink variants)
    const downloadLink = chosenMeta.SubDownloadLink || chosenMeta.SubDownloadLink || chosenMeta.SubDownloadLink || chosenMeta.URL || chosenMeta.url;
    if (!downloadLink) {
      logWarn('⚠️ No download link in metadata, returning empty');
      return res.json({ subtitles: [] });
    }
    logInfo('⚙️ Download link:', downloadLink);

    // 4) get raw content (handles gz)
    let raw;
    try {
      raw = await downloadSubtitleRaw(downloadLink);
    } catch (e) {
      logWarn('❌ Failed to fetch or decompress subtitle:', e.message);
      return res.json({ subtitles: [] });
    }

    // 5) parse into blocks
    const blocks = parseSrtToBlocks(raw);
    logInfo(`🔢 Parsed blocks: ${blocks.length}`);

    // 6) translate blocks (with caching inside libreTranslate)
    logInfo('🌐 Translating blocks via LibreTranslate (this may take a few seconds)...');
    const translatedBlocks = await translateBlocks(blocks, targetLang);
    logInfo('✅ Translation finished');

    // 7) render srt and save file
    const outSrt = renderBlocksToSrt(translatedBlocks);
    // generate filename: imdbId + subtitleOriginalId + targetLang + shorthash
    const shortHash = sha1(outSrt).slice(0, 8);
    const fname = safeFilename(`${imdbId}_${originalId}_${targetLang}_${shortHash}.srt`);
    const fpath = path.join(SUBS_DIR, fname);
    fs.writeFileSync(fpath, outSrt, 'utf8');
    logInfo('💾 Saved translated SRT to', fpath);

    // 8) cache metadata mapping to file
    cache.set(cacheKey, { file: fpath });

    // 9) respond with subtitle metadata for Stremio
    const fileUrl = PUBLIC_BASE_URL + '/subs/' + fname;
    const name = `${LANG_MAP[targetLang] || targetLang} _ Auto Translate RDG`;
    const elapsed = Date.now() - startTs;
    logInfo(`⏱️ Finished in ${elapsed}ms — returning translated subtitle: ${fileUrl}`);
    return res.json({ subtitles: [{ id: cacheKey, lang: targetLang, name: name, url: fileUrl }] });
  } catch (e) {
    logError('🔥 Unexpected error in /subtitles handler:', e && e.stack ? e.stack : e);
    return res.json({ subtitles: [] });
  }
});

// small root
app.get('/', (req, res) => {
  res.redirect('/configure');
});

// escape helpers
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[m]);
}
function escapeJs(s) {
  if (!s) return '';
  return String(s).replace(/'/g, "\\'");
}

// start server
app.listen(PORT, () => {
  logInfo(`🚀 Auto-Translate-RDG running at ${PUBLIC_BASE_URL} (port ${PORT}) [DEBUG logs active]`);
  logInfo(`📡 LibreTranslate API: ${LIBRETRANSLATE_API}`);
});
