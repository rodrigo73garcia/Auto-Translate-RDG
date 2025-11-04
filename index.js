var express = require('express');
var path = require('path');
var fs = require('fs');
var cors = require('cors');
var axios = require('axios');
var translate = require('@vitalets/google-translate-api');
var NodeCache = require('node-cache');
require('dotenv').config();

var app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

var PORT = process.env.PORT || 8000;

function getBaseUrl(req) {
  var fromEnv = process.env.PUBLIC_BASE_URL;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  var proto = req.protocol || 'http';
  var host = req.get('host') || 'localhost:' + PORT;
  return proto + '://' + host;
}

var SUBS_DIR = path.join(__dirname, 'subs');
if (!fs.existsSync(SUBS_DIR)) fs.mkdirSync(SUBS_DIR);
var cache = new NodeCache({ stdTTL: 604800 });

var TOP20 = [
  { name: 'Português (Brasil) - pt-BR', value: 'pt-BR' },
  { name: 'Inglês - en', value: 'en' },
  { name: 'Espanhol - es', value: 'es' },
  { name: 'Francês - fr', value: 'fr' }
];

function safeFilename(str) {
  return String(str).replace(/[^a-z0-9-_.]/gi, '_');
}

function parseUpstreams(input) {
  return String(input || '').split(',').map(function(s) {
    return s.trim();
  }).filter(function(x) {
    return x;
  }).map(function(s) {
    return s.replace(//+$/, '');
  });
}

function getConfiguredUpstreams(extraUpstreams) {
  var fromExtra = parseUpstreams(extraUpstreams);
  if (fromExtra.length) return fromExtra;
  var env = process.env.STREMIO_SUBS_BASES || 'https://opensubtitles-v3.stremio.online';
  return parseUpstreams(env);
}

function fetchUpstreamSubtitles(type, id, upstreams, callback) {
  var all = [];
  var pending = upstreams.length;
  if (pending === 0) return callback(null, all);
  
  upstreams.forEach(function(base) {
    var url = base + '/subtitles/' + encodeURIComponent(type) + '/' + encodeURIComponent(id) + '.json';
    axios.get(url, { timeout: 15000 }).then(function(resp) {
      var arr = (resp.data && resp.data.subtitles) || [];
      all = all.concat(arr);
      pending--;
      if (pending === 0) callback(null, all);
    }).catch(function() {
      pending--;
      if (pending === 0) callback(null, all);
    });
  });
}

function pickPreferredEnglish(subs) {
  if (!subs || !subs.length) return null;
  for (var i = 0; i < subs.length; i++) {
    if (String(subs[i].lang || '').toLowerCase().startsWith('en')) return subs[i];
  }
  return subs[0] || null;
}

function downloadAsSrt(url, callback) {
  axios.get(url, { responseType: 'arraybuffer', timeout: 20000 }).then(function(resp) {
    callback(null, Buffer.from(resp.data).toString('utf8'));
  }).catch(callback);
}

function translateText(text, targetLang, callback) {
  translate(text, { to: targetLang }).then(function(res) {
    callback(null, res.text);
  }).catch(function() {
    callback(null, text);
  });
}

function parseExtra(req) {
  var extra = {};
  if (req.query && req.query.extra) {
    try {
      extra = JSON.parse(req.query.extra);
    } catch (e) {}
  }
  if (!Object.keys(extra).length && req.params && req.params.extra) {
    try {
      extra = JSON.parse(decodeURIComponent(req.params.extra));
    } catch (e) {}
  }
  return extra;
}

app.use('/subs', express.static(SUBS_DIR));

app.get('/manifest.json', function(req, res) {
  var base = getBaseUrl(req);
  var targetLang = req.query.targetLang || 'pt-BR';
  var upstreams = req.query.upstreams || '';
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.json({
    id: 'org.auto.translate.rdg',
    version: '1.2.3',
    name: 'Auto Translate RDG',
    description: 'Legendas traduzidas automaticamente',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
    config: [
      { key: 'targetLang', name: 'Idioma', type: 'select', options: TOP20, default: targetLang },
      { key: 'upstreams', name: 'Upstreams CSV', type: 'text', default: upstreams }
    ],
    behaviorHints: {
      configurable: true,
      configurationRequired: false,
      config_url: base + '/configure'
    }
  });
});

app.get('/subtitles/:type/:id/:extra.json', subtitlesHandler);
app.get('/subtitles/:type/:id.json', subtitlesHandler);

function subtitlesHandler(req, res) {
  var base = getBaseUrl(req);
  var type = req.params.type;
  var id = req.params.id;
  var extra = parseExtra(req);
  var targetLang = extra.targetLang || extra.lang || req.query.targetLang || 'pt-BR';
  var upstreams = getConfiguredUpstreams(extra.upstreams || req.query.upstreams);
  var cacheKey = type + '_' + id + '_' + targetLang + '_' + upstreams.join('|');
  var cached = cache.get(cacheKey);
  
  if (cached) return res.json({ subtitles: [cached] });
  if (!upstreams.length) return res.json({ subtitles: [] });

  fetchUpstreamSubtitles(type, id, upstreams, function(err, list) {
    if (err || !list || !list.length) return res.json({ subtitles: [] });
    
    var chosen = pickPreferredEnglish(list);
    if (!chosen || !chosen.url) return res.json({ subtitles: [] });
    
    downloadAsSrt(chosen.url, function(errDownload, srtText) {
      if (errDownload || !srtText) return res.json({ subtitles: [] });
      
      var lines = srtText.split('
');
      var out = [];
      var pending = 0;
      
      lines.forEach(function(line, idx) {
        if (/^d+$/.test(line) || line.includes('-->') || line.trim() === '') {
          out[idx] = line;
        } else {
          pending++;
          translateText(line, targetLang, function(errTrans, translated) {
            out[idx] = translated || line;
            pending--;
            if (pending === 0) {
              var fname = safeFilename(id + '_' + targetLang + '.srt');
              fs.writeFileSync(path.join(SUBS_DIR, fname), out.join('
'), 'utf8');
              var url = base + '/subs/' + fname;
              var subObj = { id: id + '-' + targetLang + '-rdg', lang: targetLang, url: url };
              cache.set(cacheKey, subObj);
              res.json({ subtitles: [subObj] });
            }
          });
        }
      });
      
      if (pending === 0) {
        var fname = safeFilename(id + '_' + targetLang + '.srt');
        fs.writeFileSync(path.join(SUBS_DIR, fname), out.join('
'), 'utf8');
        var url = base + '/subs/' + fname;
        var subObj = { id: id + '-' + targetLang + '-rdg', lang: targetLang, url: url };
        cache.set(cacheKey, subObj);
        res.json({ subtitles: [subObj] });
      }
    });
  });
}

app.get('/configure', function(req, res) {
  var base = getBaseUrl(req);
  var targetLang = req.query.targetLang || 'pt-BR';
  var upstreams = req.query.upstreams || '';
  var opts = '';
  
  TOP20.forEach(function(opt) {
    var sel = opt.value === targetLang ? 'selected' : '';
    opts += '<option ' + sel + ' value="' + opt.value + '">' + opt.name + '</option>';
  });
  
  var installUrl = base + '/manifest.json?targetLang=' + encodeURIComponent(targetLang) + '&upstreams=' + encodeURIComponent(upstreams);
  var html = '<html><head><meta charset="utf-8"><title>Auto Translate RDG</title></head>' +
    '<body style="font-family:sans-serif;padding:24px;max-width:880px">' +
    '<h2>Auto Translate RDG</h2>' +
    '<form method="GET" action="/configure">' +
    '<label>Idioma:</label><select name="targetLang">' + opts + '</select><br/><br/>' +
    '<label>Upstreams CSV:</label><br/>' +
    '<input style="width:100%" type="text" name="upstreams" value="' + upstreams + '"/><br/><br/>' +
    '<button type="submit">Gerar</button></form>' +
    '<p>Link:</p><pre style="background:#f7f7f7;padding:12px">' + installUrl + '</pre>' +
    '<p><a href="' + installUrl + '">Abrir manifest</a></p></body></html>';
  
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.get('/health', function(req, res) {
  res.json({ status: 'ok' });
});

app.listen(PORT, function() {
  var base = process.env.PUBLIC_BASE_URL || 'http://localhost:' + PORT;
  console.log('Auto Translate RDG rodando na porta ' + PORT);
  console.log('Página: ' + base + '/configure');
});
