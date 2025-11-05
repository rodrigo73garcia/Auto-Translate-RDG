import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import translate from "google-translate-api-x";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

// Pasta de cache local
const CACHE_DIR = path.join(__dirname, "cache");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// Função para buscar a primeira legenda em inglês no OpenSubtitles
async function fetchSubtitleFromOpenSubtitles(imdbId) {
  const url = `https://rest.opensubtitles.org/search/imdbid-${imdbId}/sublanguageid-eng`;
  const headers = { "User-Agent": "TemporaryUserAgent" };

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Erro OpenSubtitles: ${res.statusText}`);

  const data = await res.json();
  if (!data || !data.length) throw new Error("Nenhuma legenda encontrada");

  const subUrl = data[0].SubDownloadLink.replace(".gz", "");
  const srtRes = await fetch(subUrl);
  const srtText = await srtRes.text();

  return srtText;
}

// Função de tradução real com google-translate-api-x
async function translateSubtitle(text, targetLang = "pt") {
  try {
    const result = await translate(text, { to: targetLang });
    return result.text;
  } catch (err) {
    log("Erro ao traduzir legenda: " + err.message);
    throw err;
  }
}

// Rota principal para buscar/traduzir legendas
app.get("/subtitles/:type/:imdbParam", async (req, res) => {
  try {
    const { type, imdbParam } = req.params;
    const imdbId = imdbParam.replace(".json", "").replace("tt", "");
    log(`Nova requisição -> type: ${type}, imdb: ${imdbId}`);

    const cachePath = path.join(CACHE_DIR, `${type}_${imdbId}.srt`);
    if (fs.existsSync(cachePath)) {
      log(`Legenda em cache encontrada: ${cachePath}`);
      return res.sendFile(cachePath);
    }

    log("🔍 Buscando legenda original no OpenSubtitles...");
    const srtText = await fetchSubtitleFromOpenSubtitles(imdbId);
    log(`Legenda original obtida (${srtText.length} bytes)`);

    log("🌐 Traduzindo legenda para pt-br...");
    const translated = await translateSubtitle(srtText, "pt");

    fs.writeFileSync(cachePath, translated, "utf8");
    log(`Legenda traduzida salva: ${path.basename(cachePath)}`);

    res.type("text/plain").send(translated);
  } catch (err) {
    log("Erro na rota: " + err.message);
    res.status(500).send("Erro ao processar legenda.");
  }
});

// Endpoint do manifesto (para o Stremio)
app.get("/manifest.json", (req, res) => {
  const manifest = {
    id: "org.rdg.autotranslate",
    version: "2.0.0",
    name: "Auto Translate RDG",
    description: "Traduz legendas automaticamente para Português (Brasil)",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [],
  };
  res.json(manifest);
});

app.listen(PORT, () => {
  log(`Servidor iniciado na porta ${PORT}`);
});
