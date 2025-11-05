import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import pLimit from "p-limit";

const app = express();
const PORT = process.env.PORT || 10000;
const __dirname = path.resolve();
const SUBS_DIR = path.join(__dirname, "subtitles");

if (!fs.existsSync(SUBS_DIR)) fs.mkdirSync(SUBS_DIR);

// ----------------------------
// 🔹 Função utilitária: pausa
// ----------------------------
const delay = ms => new Promise(r => setTimeout(r, ms));

// ----------------------------
// 🔹 Rota do manifesto Stremio
// ----------------------------
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "auto-translate-rdg",
    version: "1.0.0",
    name: "Auto Translate RDG",
    description: "Addon que traduz automaticamente legendas para PT-BR usando API de tradução.",
    types: ["movie", "series"],
    catalogs: [],
    resources: [
      {
        name: "subtitles",
        types: ["movie", "series"],
        idPrefixes: ["tt"]
      }
    ],
    idPrefixes: ["tt"],
    background: "https://auto-translate-rdg.onrender.com",
    logo: "https://stremio-logo.s3.eu-west-1.amazonaws.com/stremio.png"
  });
});

// ----------------------------
// 🔹 Busca legenda original
// ----------------------------
async function getOriginalSubtitle(imdbId) {
  const apiUrl = `https://rest.opensubtitles.org/search/imdbid-${imdbId}/sublanguageid-eng`;
  console.log(`[${new Date().toISOString()}] Buscando legendas originais: ${apiUrl}`);

  const response = await fetch(apiUrl, {
    headers: { "User-Agent": "TemporaryUserAgent" }
  });
  const data = await response.json();
  if (!data || !data.length) throw new Error("Nenhuma legenda encontrada");

  const subtitleUrl = data[0].url;
  console.log(`[${new Date().toISOString()}] Link da legenda encontrado: ${subtitleUrl}`);

  const subtitleResponse = await fetch(subtitleUrl);
  const srt = await subtitleResponse.text();
  console.log(`[${new Date().toISOString()}] Legenda original obtida (${srt.length} bytes)`);
  return srt;
}

// ----------------------------
// 🔹 Tradução (API livre usada)
// ----------------------------
async function translateText(text) {
  const body = {
    q: text,
    source: "en",
    target: "pt",
    format: "text"
  };
  const res = await fetch("https://libretranslate.de/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  return json.translatedText || "";
}

// ----------------------------
// 🔹 Tradução em blocos paralelos
// ----------------------------
async function translateSubtitleBlocks(originalSrt) {
  const lines = originalSrt.split("\n");
  const blocks = [];
  let current = "";

  for (const line of lines) {
    if ((current + line + "\n").length > 4500) {
      blocks.push(current);
      current = "";
    }
    current += line + "\n";
  }
  if (current.trim()) blocks.push(current);

  console.log(`Traduzindo ${blocks.length} blocos (${lines.length} linhas totais)...`);

  // Limitar requisições simultâneas (para não sobrecarregar API)
  const limit = pLimit(4);
  const translatedBlocks = await Promise.all(
    blocks.map((block, i) =>
      limit(async () => {
        const translated = await translateText(block);
        console.log(`✔️ Bloco ${i + 1}/${blocks.length} traduzido`);
        await delay(200); // leve pausa entre requisições
        return translated;
      })
    )
  );

  return translatedBlocks.join("\n");
}

// ----------------------------
// 🔹 Rota principal Stremio
// ----------------------------
app.get("/subtitles/:type/:imdbId.json", async (req, res) => {
  const { imdbId } = req.params;
  const langCode = "pt";
  const cachePath = path.join(SUBS_DIR, `${imdbId}_${langCode}.srt`);

  console.log(`[${new Date().toISOString()}] Nova requisição -> type: ${req.params.type}, imdb: ${imdbId}`);

  // 🔸 Verifica cache
  if (fs.existsSync(cachePath)) {
    console.log(`[${new Date().toISOString()}] Legenda encontrada em cache: ${cachePath}`);
    return res.json({
      subtitles: [
        {
          id: `${imdbId}:${langCode}`,
          url: `https://auto-translate-rdg.onrender.com/subtitles/file/${imdbId}_${langCode}.srt`,
          lang: langCode,
          name: "Auto-Translated (PT)"
        }
      ]
    });
  }

  try {
    const originalSrt = await getOriginalSubtitle(imdbId);
    const translatedSrt = await translateSubtitleBlocks(originalSrt);
    fs.writeFileSync(cachePath, translatedSrt, "utf8");
    console.log(`[${new Date().toISOString()}] Legenda traduzida salva: ${path.basename(cachePath)}`);

    res.json({
      subtitles: [
        {
          id: `${imdbId}:${langCode}`,
          url: `https://auto-translate-rdg.onrender.com/subtitles/file/${imdbId}_${langCode}.srt`,
          lang: langCode,
          name: "Auto-Translated (PT)"
        }
      ]
    });
  } catch (err) {
    console.error("Erro:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------
// 🔹 Servir legendas salvas
// ----------------------------
app.get("/subtitles/file/:file", (req, res) => {
  const filePath = path.join(SUBS_DIR, req.params.file);
  if (!fs.existsSync(filePath)) return res.status(404).send("Arquivo não encontrado");
  res.sendFile(filePath);
});

// ----------------------------
// 🔹 Inicialização
// ----------------------------
app.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});
