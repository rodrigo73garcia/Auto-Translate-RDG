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
  const fromEnv = process.env.PUBLIC_BASE_URL && process.env.PUBLIC_BASE_URL.trim();
  if (fromEnv) return fromEnv;
  const proto = (req && req.protocol) || 'http';
  const host = (req && req.get && req.get('host')) || 'localhost:' + PORT;
  return proto + '://' + host;
}

const SUBS_DIR = path.join(__dirname, 'subs');
if (!fs.existsSync(SUBS_DIR)) fs.mkdirSync(SUBS_DIR);
const cache = new NodeCache({ stdTTL: 604800 });

const TOP20 = [
  { name: 'Inglês - en', value: 'en' }, { name: 'Chinês (Mandarim) - zh-CN', value: 'zh-CN' },
  { name: 'Hindi - hi', value: 'hi' }, { name: 'Espanhol - es', value: 'es' },
  { name: 'Francês - fr', value: 'fr' }, { name: 'Árabe - ar', value: 'ar' },
  { name: 'Bengali - bn', value: 'bn' }, { name: 'Português (Brasil) - pt-BR', value: 'pt-BR' },
  { name: 'Russo - ru', value: 'ru' }, { name: 'Urdu - ur', value: 'ur' },
  { name: 'Indonésio - id', value: 'id' }, { name: 'Alemão - de', value: 'de' },
  { name: 'Japonês - ja', value: 'ja' }, { name: 'Suaíli - sw', value: 'sw' },
  { name: 'Marati - mr', value: 'mr' }, { name: 'Télugo - te', value: 'te' },
  { name: 'Turco - tr', value: 'tr' }, { name: 'Tâmil - ta', value: 'ta' },
  { name: 'Italiano - it', value: 'it' }, { name: 'Persa (Farsi) - fa', value: 'fa' }
];

function safeFilename(str) { return String(str).replace(/[^a-z0-9-_.]/gi, '_'); }
function parseUpstreams(input) {
  return String(input || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean).map(function(s) { return s.replace(//+$/, ''); });
}
function getConfiguredUpstreams(extraUpstreams) {
  var fromExtra = parseUpstreams(extraUpstreams);
  if (fromExtra.length) return fromExtra;
  var env = process.env.STREMIO_SUBS_BASES || 'https://opensubtitles-v3.stremio.online';
  return parseUpstreams(env);
}
async function fetchUpstreamSubtitles(type, id, upstreams) {
  var all = [];
  for (var i = 0; i < upstreams.length; i++) {
    var base = upstreams[i];
    var url = base + '/subtitles/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '.json';
    try {
      var resp = await axios.get(url, { timeout: 15000 });
      var arr = (resp.data && resp.data.subtitles) || [];
      for (var j = 0; j < arr.length; j++) all.push(arr[j]);
    } catch (_) {}
  }
  return all;
}
function pickPreferredEnglish(subs) {
  if (!subs || !subs.length) return null;
  var en = subs.find(function(s) { return (String(s.lang || '').toLowerCase()).startsWith('en'); });
  return en || subs[0] || null;
}
async function downloadAsSrt(url) {
  var resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 });
  return Buffer.from(resp.data).toString('utf8');
}
async function translateText(text, targetLang) {
  try { var res = await translate(text, { to: targetLang }); return res.text; }
  catch (_) { return text; }
}
function parseExtra(req) {
  var extra = {};
  if (req.query && req.query.extra) { try { extra = JSON.parse(req.query.extra); } catch (_) {} }
  if (!Object.keys(extra).length && req.params && req.params.extra) {
    try { extra = JSON.parse(decodeURIComponent(req.params.extra)); } catch (_) {}
  }
  return extra || {};
}

app.use('/subs', express.static(SUBS_DIR));

app.get('/manifest.json', function(req, res) {
  var base = getBaseUrl(req);
  var targetLang = req.query.targetLang || 'pt-BR';
  var upstreams = req.query.upstreams || '';
  var manifest = {
    id: 'org.auto.translate.rdg',
    version: '1.2.3',
    name: 'Auto Translate RDG',
    description: 'Subtitles-only: lê legendas de addons Stremio, prioriza EN, traduz e serve .srt no idioma escolhido.',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
    config: [
      { key: 'targetLang', name: 'Idioma alvo das legendas', type: 'select', options: TOP20, default: targetLang },
      { key: 'upstreams', name: 'Base URLs de addons de legendas (separadas por vírgula)', type: 'text', default: upstreams }
    ],
    behaviorHints: { configurable: true, configurationRequired: false, config_url: base + '/configure' }
  };
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json(manifest);
});

app.get('/subtitles/:type/:id/:extra.json', subtitlesHandler);
app.get('/subtitles/:type/:id.json', subtitlesHandler);

async function subtitlesHandler(req, res) {
  var base = getBaseUrl(req);
  var type = req.params.type;
  var id = req.params.id;
  var extra = parseExtra(req);
  var targetLang = extra.targetLang || extra.lang || req.query.targetLang || 'pt-BR';
  var upstreams = getConfiguredUpstreams(extra.upstreams || req.query.upstreams);

  var cacheKey = type + '_' + id + '_' + targetLang + '_' + upstreams.join('|');
  var cached = cache.get(cacheKey);
  if (cached) return res.json({ subtitles: [cached] });

  try {
    if (!upstreams.length) return res.json({ subtitles: [] });

    var list = await fetchUpstreamSubtitles(type, id, upstreams);
    var chosen = pickPreferredEnglish(list);
    if (!chosen || !chosen.url) return res.json({ subtitles: [] });

    var srtText = await downloadAsSrt(chosen.url);
    var lines = srtText.split('
');
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^d+$/.test(line) || line.includes('-->') || line.trim() === '') out.push(line);
      else out.push(await translateText(line, targetLang));
    }

    var fname = safeFilename(id + '_' + targetLang + '.srt');
    fs.writeFileSync(path.join(SUBS_DIR, fname), out.join('
'), 'utf8');

    var url = base + '/subs/' + fname;
    var subObj = { id: id + '-' + targetLang + '-rdg', lang: targetLang, url: url };
    cache.set(cacheKey, subObj);
    res.json({ subtitles: [subObj] });
  } catch (_) {
    res.json({ subtitles: [] });
  }
}

app.get('/configure', function(req, res) {
  var base = getBaseUrl(req);
  var targetLang = req.query.targetLang || 'pt-BR';
  var upstreams = req.query.upstreams || '';
  var optionsHtml = TOP20.map(function(opt) {
    var sel = opt.value === targetLang ? 'selected' : '';
    return '<option ' + sel + ' value="' + opt.value + '">' + opt.name + '</option>';
  }).join('');
  var installUrl = base + '/manifest.json?targetLang=' + encodeURIComponent(targetLang) + '&upstreams=' + encodeURIComponent(upstreams);
  var html = '<html><head><meta charset="utf-8"><title>Auto Translate RDG</title></head>' +
    '<body style="font-family: system-ui, sans-serif; padding: 24px; max-width: 880px;">' +
    '<h2>Auto Translate RDG</h2>' +
    '<form method="GET" action="/configure" style="margin-bottom:16px">' +
    '<label>Idioma alvo:&nbsp;</label><select name="targetLang">' + optionsHtml + '</select><br/><br/>' +
    '<label>Upstreams (URLs de addons de legendas, separadas por vírgula):</label><br/>' +
    '<input style="width:100%" type="text" name="upstreams" placeholder="https://addon1.xyz, https://addon2.xyz" value="' + upstreams + '"/>' +
    '<br/><br/><button type="submit">Gerar link de instalação</button></form>' +
    '<p>Instalar no Stremio usando o manifest:</p>' +
    '<pre style="white-space:pre-wrap; background:#f7f7f7; padding:12px; border-radius:8px">' + installUrl + '</pre>' +
    '<p><a href="' + installUrl + '">Abrir manifest.json</a></p></body></html>';
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.get('/health', function(req, res) { res.json({ status: 'ok' }); });

app.listen(PORT, function() {
  var base = process.env.PUBLIC_BASE_URL || 'http://localhost:' + PORT;
  console.log('Auto Translate RDG rodando na porta ' + PORT);
  console.log('Página de configuração: ' + base + '/configure');
});
