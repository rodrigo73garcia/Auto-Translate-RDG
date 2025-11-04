import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "http://localhost:" + PORT;

// Endpoint de tradução (LibreTranslate)
const LIBRETRANSLATE_URL = process.env.LIBRETRANSLATE_API || "https://libretranslate.com/translate";

// Upstreams fixos (pré-configurados e atualizados)
const defaultUpstreams = [
  "https://opensubtitles.strem.fun",
  "https://kiters.strem.fun",
  "https://subs.strem.fun",
  "https://spanish.strem.fun",
  "https://v3stremio.herokuapp.com"
];

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

// Função para buscar legendas de múltiplas fontes com fallback
async function fetchSubtitlesFromSources(imdbId) {
  for (const base of defaultUpstreams) {
    try {
      const url = `${base}/subtitles/movie/${imdbId}.json`;
      console.log("🔍 Buscando legendas em:", url);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const subs = await response.json();
      if (Array.isArray(subs) && subs.length > 0) {
        console.log(`✅ Encontradas ${subs.length} legendas em ${base}`);
        return subs;
      } else {
        console.log(`⚠️ Nenhuma legenda válida encontrada em ${base}`);
      }
    } catch (e) {
      console.log(`❌ Erro ao buscar em ${base}:`, e.message);
    }
  }
  console.log("🚫 Nenhuma legenda encontrada em nenhuma fonte.");
  return [];
}

// Rota principal de legendas
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const targetLang = req.query.targetLang || "pt-BR";
  const imdbId = req.params.id.split(":")[0];

  console.log(`🎬 Solicitando legendas para ${imdbId} → tradução para ${targetLang}`);

  // Busca de legendas
  const subtitles = await fetchSubtitlesFromSources(imdbId);

  if (!subtitles.length) {
    return res.json({ subtitles: [] });
  }

  // Filtro de prioridade: primeiro inglês, senão qualquer idioma
  let selectedSubs = subtitles.filter(s => s.language === "en" || s.language === "eng");
  if (!selectedSubs.length) selectedSubs = subtitles;

  // Tradução automática
  const translated = await Promise.all(
    selectedSubs.map(async (sub) => {
      try {
        const text = sub.data || "";
        if (!text.trim()) return null;

        const resp = await fetch(LIBRETRANSLATE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            q: text,
            source: "auto",
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
        console.error("⚠️ Falha ao traduzir legenda:", e.message);
        return null;
      }
    })
  );

  const filtered = translated.filter(Boolean);
  console.log(`🈶 Retornando ${filtered.length} legendas traduzidas.`);
  res.json({ subtitles: filtered });
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

// Rota raiz → redireciona para /configure
app.get("/", (req, res) => {
  res.redirect("/configure");
});

// Inicialização
app.listen(PORT, () => {
  console.log(`🚀 Auto-Translate Addon rodando em ${PUBLIC_BASE_URL}`);
});
