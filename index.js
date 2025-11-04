import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "http://localhost:" + PORT;

// Diretório para salvar legendas traduzidas
const SUBS_DIR = path.join(__dirname, "subs");
if (!fs.existsSync(SUBS_DIR)) fs.mkdirSync(SUBS_DIR);

// Upstreams fixos
const defaultUpstreams = [
  "https://opensubtitles.strem.fun",
  "https://legendas.tv.strem.fun"
];

// LibreTranslate endpoint
const LIBRETRANSLATE_URL = process.env.LIBRETRANSLATE_API || "https://libretranslate.com/translate";

// Idiomas (21)
const LANGUAGES = {
  en: "English",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  it: "Italiano",
  pt: "Português (Portugal)",
  "pt-BR": "Português (Brasil)",
  ru: "Русский",
  zh: "中文 (Chinese)",
  ja: "日本語 (Japanese)",
  ko: "한국어 (Korean)",
  ar: "العربية (Arabic)",
  hi: "हिन्दी (Hindi)",
  tr: "Türkçe",
  nl: "Nederlands",
  pl: "Polski",
  sv: "Svenska",
  no: "Norsk",
  fi: "Suomi",
  he: "עברית (Hebrew)",
  id: "Bahasa Indonesia"
};

// Função utilitária
function safe(str) {
  return String(str).replace(/[^a-z0-9-_.]/gi, "_");
}

// Página de configuração multilíngue
app.get("/configure", (req, res) => {
  const userLang = req.acceptsLanguages(Object.keys(LANGUAGES)) || "en";
  const selectedLang = LANGUAGES[userLang] ? userLang : "en";

  const options = Object.entries(LANGUAGES)
    .map(([code, name]) => `<option value="${code}" ${code === selectedLang ? "selected" : ""}>${name}</option>`)
    .join("");

  const labels = {
    en: {
      title: "Auto-Translate RDG Addon Configuration",
      langLabel: "Select target language:",
      button: "Generate Installation Link"
    },
    pt: {
      title: "Configuração do Addon Auto-Translate RDG",
      langLabel: "Selecione o idioma de destino:",
      button: "Gerar link de instalação"
    }
  };

  const text = labels[selectedLang.startsWith("pt") ? "pt" : "en"];

  res.send(`
    <html lang="${selectedLang}">
      <head>
        <meta charset="utf-8">
        <title>${text.title}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 30px; background: #121212; color: #fff; }
          h1 { font-size: 1.6rem; margin-bottom: 1rem; }
          select, button { padding: 10px; font-size: 1rem; border-radius: 5px; border: none; }
          select { margin-right: 10px; }
          button { background: #4CAF50; color: #fff; cursor: pointer; }
          a { color: #4CAF50; word-break: break-all; }
        </style>
      </head>
      <body>
        <h1>${text.title}</h1>
        <form onsubmit="generateLink(event)">
          <label>${text.langLabel}</label><br><br>
          <select id="lang">${options}</select>
          <button type="submit">${text.button}</button>
        </form>
        <p id="link"></p>
        <script>
          function generateLink(e) {
            e.preventDefault();
            const lang = document.getElementById('lang').value;
            const manifest = '${PUBLIC_BASE_URL}/manifest.json?targetLang=' + lang;
            const link = 'stremio://' + manifest;
            document.getElementById('link').innerHTML =
              '<br><strong>Install link:</strong><br><a href="' + link + '">' + link + '</a>';
          }
        </script>
      </body>
    </html>
  `);
});

// Manifest
app.get("/manifest.json", (req, res) => {
  const targetLang = req.query.targetLang || "pt-BR";
  res.json({
    id: "org.auto.translate.rdg",
    version: "1.2.0",
    name: `Auto-Translate (${LANGUAGES[targetLang] || targetLang})`,
    description: `Automatically translates subtitles to ${LANGUAGES[targetLang] || targetLang}`,
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: false }
  });
});

// Endpoint principal de legendas
app.get("/subtitles/:type/:id.json", async (req, res) => {
  const { type, id } = req.params;
  const targetLang = req.query.targetLang || "pt-BR";
  const imdbId = id.split(":")[0];

  let subs = [];

  // Tenta buscar legendas em inglês, se não tiver pega qualquer idioma
  for (const base of defaultUpstreams) {
    try {
      const url = `${base}/subtitles/${type}/${imdbId}.json`;
      const response = await fetch(url);
      if (!response.ok) continue;
      const json = await response.json();
      const arr = json.subtitles || [];
      subs = arr.filter(s => s.lang.startsWith("en"));
      if (subs.length === 0) subs = arr;
      if (subs.length > 0) break;
    } catch (e) {
      console.error("Erro ao buscar em", base, e.message);
    }
  }

  if (!subs.length) return res.json({ subtitles: [] });

  const chosen = subs[0];
  const subtitleUrl = chosen.url;

  try {
    const srt = await (await fetch(subtitleUrl)).text();
    const translatedLines = [];
    const lines = srt.split("\n");

    for (const line of lines) {
      if (/^\d+$/.test(line) || line.includes("-->") || !line.trim()) {
        translatedLines.push(line);
      } else {
        const resp = await fetch(LIBRETRANSLATE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q: line, source: "auto", target: targetLang, format: "text" })
        });
        const data = await resp.json();
        translatedLines.push(data.translatedText || line);
      }
    }

    const fname = safe(imdbId + "_" + targetLang + ".srt");
    const fpath = path.join(SUBS_DIR, fname);
    fs.writeFileSync(fpath, translatedLines.join("\n"), "utf8");

    const subUrl = `${PUBLIC_BASE_URL}/subs/${fname}`;
    res.json({ subtitles: [{ id: imdbId + "-" + targetLang, lang: targetLang, url: subUrl }] });
  } catch (e) {
    console.error("Falha ao traduzir legenda:", e.message);
    res.json({ subtitles: [] });
  }
});

app.use("/subs", express.static(SUBS_DIR));

app.get("/", (req, res) => res.redirect("/configure"));

app.listen(PORT, () => {
  console.log(`🚀 Auto-Translate RDG running on ${PUBLIC_BASE_URL}`);
});
