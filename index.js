import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;
const LIBRETRANSLATE_API = process.env.LIBRETRANSLATE_API || "https://libretranslate.com";
const USER_AGENT = "TemporaryUserAgentForRDG-TranslateAddon";

// Busca legendas no OpenSubtitles (REST API pública)
async function fetchOpenSubtitles(imdbId) {
  const imdbNum = imdbId.replace("tt", "");
  const url = `https://rest.opensubtitles.org/search/imdbid-${imdbNum}`;

  console.log(`🔍 Buscando legendas em: ${url}`);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      timeout: 20000,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const subs = await res.json();
    console.log(`✅ ${subs.length} legendas encontradas`);
    return subs;
  } catch (err) {
    console.log(`❌ Erro ao buscar legendas: ${err.message}`);
    return [];
  }
}

// Traduz texto simples via LibreTranslate
async function translateText(text, targetLang = "pt") {
  try {
    const res = await fetch(`${LIBRETRANSLATE_API}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: text,
        source: "en",
        target: targetLang,
        format: "text",
      }),
    });
    const data = await res.json();
    return data.translatedText || text;
  } catch (err) {
    console.error("Erro na tradução:", err.message);
    return text;
  }
}

// Endpoint principal de legendas
app.get("/subtitles/:type/:imdbId.json", async (req, res) => {
  const { imdbId } = req.params;
  const targetLang = (req.query.lang || "pt-BR").toLowerCase();

  console.log(`🎬 Solicitando legendas para ${imdbId} → tradução para ${targetLang}`);

  const subs = await fetchOpenSubtitles(imdbId);
  if (!subs.length) return res.json({ subtitles: [] });

  // Seleciona a primeira legenda em inglês ou qualquer outra se não houver
  const englishSub = subs.find(s => s.iso639 === "en") || subs[0];

  // Traduz o nome do idioma
  const translatedName = await translateText(englishSub.lang || "English", targetLang);

  // Retorna no formato esperado pelo Stremio
  const result = [
    {
      id: "auto-translated",
      lang: `${translatedName} (traduzido)`,
      url: englishSub.SubDownloadLink,
    },
  ];

  res.json({ subtitles: result });
});

// Página inicial simples
app.get("/", (req, res) => {
  res.send("🟢 Addon ativo — usando OpenSubtitles REST API + LibreTranslate!");
});

app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
