import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;
const LIBRETRANSLATE_API = process.env.LIBRETRANSLATE_API || "https://libretranslate.com";

const STREMIO_SOURCES = [
  "https://opensubtitles-v3.stremio.online",
  "https://yifysubtitles.strem.fun",
  "https://v3stremio.onrender.com",
  "https://legendas-tv.stremio.online",
  "https://brazucas.strem.fun"
];

// Função para buscar legendas em múltiplas fontes
async function fetchSubtitles(imdbId, type = "movie") {
  for (const base of STREMIO_SOURCES) {
    const url = `${base}/subtitles/${type}/${imdbId}.json`;
    console.log(`🔍 Buscando legendas em: ${url}`);
    try {
      const res = await fetch(url, { timeout: 15000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json && json.subtitles && json.subtitles.length > 0) {
        console.log(`✅ Encontradas ${json.subtitles.length} legendas em ${base}`);
        return json.subtitles;
      }
    } catch (err) {
      console.log(`❌ Erro ao buscar em ${base}: ${err.message}`);
    }
  }
  console.log("🚫 Nenhuma legenda encontrada em nenhuma fonte.");
  return [];
}

// Traduz legenda para pt-BR usando LibreTranslate
async function translateText(text) {
  try {
    const res = await fetch(`${LIBRETRANSLATE_API}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        q: text,
        source: "en",
        target: "pt",
        format: "text"
      })
    });
    const data = await res.json();
    return data.translatedText || text;
  } catch (err) {
    console.error("Erro na tradução:", err.message);
    return text;
  }
}

app.get("/subtitles/:type/:imdbId.json", async (req, res) => {
  const { imdbId, type } = req.params;
  console.log(`🎬 Solicitando legendas para ${imdbId} → tradução para pt-BR`);
  
  const subs = await fetchSubtitles(imdbId, type);
  if (subs.length === 0) return res.json({ subtitles: [] });

  const translatedSubs = await Promise.all(subs.slice(0, 3).map(async (sub) => {
    const translatedLang = await translateText(sub.lang);
    return {
      ...sub,
      lang: `${translatedLang} (traduzido)`,
      url: sub.url
    };
  }));

  res.json({ subtitles: translatedSubs });
});

app.get("/", (req, res) => {
  res.send("🟢 Servidor de tradução de legendas ativo!");
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
