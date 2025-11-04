import express from "express";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;
const LIBRETRANSLATE_API = process.env.LIBRETRANSLATE_API || "https://libretranslate.com";

// User-Agent exigido pelo OpenSubtitles API
const USER_AGENT = "TemporaryUserAgentForRDG-TranslateAddon";

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
    console.log(`❌ Erro ao buscar em OpenSubtitles: ${err.message}`);
    return [];
  }
}

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

app.get("/subtitles/:type/:imdbId.json", async (req, res) => {
  const { imdbId } = req.params;
  const targetLang = (req.query.lang || "pt-BR").toLowerCase();

  console.log(`🎬 Solicitando legendas para ${imdbId} → tradução para ${targetLang}`);

  const subs = await fetchOpenSubtitles(imdbId);
  if (!subs.length) return res.json({ subtitles: [] });

  const englishSub = subs.find(s => s.language === "en") || subs[0];
  const translatedName = await translateText(englishSub.language, targetLang);

  const result = [
    {
      id: "auto-translated",
      lang: `${translatedName} (traduzido)`,
      url: englishSub.url,
    },
  ];

  res.json({ subtitles: result });
});

app.get("/", (req, res) => {
  res.send("🟢 Addon ativo — usando OpenSubtitles REST API + LibreTranslate!");
});

app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
