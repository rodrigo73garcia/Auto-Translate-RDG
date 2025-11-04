import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "http://localhost:" + PORT;

// Upstreams fixos (pré-configurados)
const defaultUpstreams = [
  "https://opensubtitles.strem.io",
  "https://legendas.tv.strem.io"
];

// Endpoint de tradução (LibreTranslate)
const LIBRETRANSLATE_URL = "https://libretranslate.com/translate";

// Idiomas disponíveis (21, incluindo PT-BR e PT-PT)
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

// Página de configuração multilíngue
app.get("/configure", (req, res) => {
  const userLang = req.acceptsLanguages(Object.keys(LANGUAGES)) || "en";
  const selectedLang = LANGUAGES[userLang] ? userLang : "en";

  const options = Object.entries(LANGUAGES)
    .map(([code, name]) => `<option value="${code}" ${code === selectedLang ? "selected" : ""}>${name}</option>`)
    .join("");

  const labels = {
    en: {
      title: "Auto-Translate Addon Configuration",
      langLabel: "Select target language:",
      button: "Generate Installation Link"
    },
    pt: {
      title: "Configuração do Addon Auto-Translate",
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

// Manifest (instalação no Stremio)
app.get("/manifest.json", (req, res) => {
  const targetLang = req.query.targetLang || "pt-BR";

  const manifest = {
    id: "org.auto.translate.rdg",
    version: "1.0.0",
    name: `Auto-Translate (${LANGUAGES[targetLang] || targetLang})`,
    description: `Addon that translates subtitles automatically to ${LANGUAGES[targetLang] || targetLang}`,
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [],
    behaviorHints: { configurable: true, configurationRequired: false }
  };

  res.json(manifest);
});

// Rota principal de legendas
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const targetLang = req.query.targetLang || "pt-BR";
  const imdbId = req.params.id.split(":")[0];

  let subtitles = [];

  for (const base of defaultUpstreams) {
    try {
      const url = `${base}/subtitles/${imdbId}.json`;
      const response = await fetch(url);
      if (!response.ok) continue;

      const subs = await response.json();
      if (subs && subs.length > 0) {
        subtitles = subs.filter(s => s.language === "en" || s.language === "eng");
        if (subtitles.length === 0) subtitles = subs; // se não houver inglês, usa qualquer idioma
        break;
      }
    } catch (e) {
      console.error("Erro ao buscar legendas de", base, e.message);
    }
  }

  const translated = await Promise.all(
    subtitles.map(async (sub) => {
      try {
        const resp = await fetch(LIBRETRANSLATE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            q: sub.data || "",
            source: "en",
            target: targetLang,
            format: "text"
          })
        });

        const json = await resp.json();
        if (!json.translatedText) throw new Error("Sem retorno da tradução");

        return {
          ...sub,
          language: targetLang,
          name: `[Auto-Translated] ${LANGUAGES[targetLang] || targetLang}`,
          data: json.translatedText
        };
      } catch (e) {
        console.error("Falha ao traduzir legenda:", e.message);
        return null;
      }
    })
  );

  res.json(translated.filter(Boolean));
});

// Rota raiz
app.get("/", (req, res) => {
  res.redirect("/configure");
});

app.listen(PORT, () => {
  console.log(`🚀 Auto-Translate Addon running on ${PUBLIC_BASE_URL}`);
});
