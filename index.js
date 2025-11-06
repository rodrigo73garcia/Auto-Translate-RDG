import express from "express";
import fetch from "node-fetch";
import fs from "fs-extra";
import path from "path";
import cors from "cors";
import morgan from "morgan";
import translate from "google-translate-api-x";

const app = express();
const PORT = process.env.PORT || 10000;

// Base URL do seu app (Render)
const BASE_URL = "https://auto-translate-rdg.onrender.com";
const OPEN_SUBTITLES_API = "https://rest.opensubtitles.org";
const CACHE_DIR = "./cache";

// Garantir diretório de cache
await fs.ensureDir(CACHE_DIR);

app.use(cors());
app.use(morgan("dev"));

// --- MANIFEST STREMIO ---
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "auto-translate-rdg",
    version: "1.0.0",
    name: "Auto Translate RDG",
    description: "Addon que traduz automaticamente legendas para PT-BR usando Google Translate.",
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
    background: BASE_URL,
    logo: "https://stremio-logo.s3.eu-west-1.amazonaws.com/stremio.png"
  });
});

// --- ROTA PRINCIPAL DE LEGENDAS ---
app.get("/subtitles/:type/:imdbId/:extra?.json", async (req, res) => {
  try {
    const { type, imdbId } = req.params;
    const imdbParts = imdbId.split(":");
    const imdbPure = imdbParts[0].replace("tt", "");
    const season = imdbParts[1];
    const episode = imdbParts[2];

    const cacheName = `${imdbId.replace(/:/g, "_")}.pt.srt`;
    const cachePath = path.join(CACHE_DIR, cacheName);
    const cacheUrl = `${BASE_URL}/cache/${cacheName}`;

    console.log(`[${new Date().toISOString()}] 🔹 Requisição recebida -> ${imdbId}`);

    // 1️⃣ Verificar cache
    if (await fs.pathExists(cachePath)) {
      console.log("✅ Cache encontrado, servindo legenda do cache.");
      return res.json([
        {
          id: imdbId,
          url: cacheUrl,
          lang: "Portuguese",
          langcode: "pt",
          filename: `${imdbId}.pt.srt`
        }
      ]);
    }

    // 2️⃣ Montar URL do OpenSubtitles
    let searchUrl = `${OPEN_SUBTITLES_API}/search/imdbid-${imdbPure}/sublanguageid-eng`;
    if (type === "series" && season && episode) {
      searchUrl = `${OPEN_SUBTITLES_API}/search/imdbid-${imdbPure}/season-${season}/episode-${episode}/sublanguageid-eng`;
    }

    console.log("Buscando legendas originais:", searchUrl);

    // 3️⃣ Buscar legenda
    const response = await fetch(searchUrl, {
      headers: { "User-Agent": "TemporaryUserAgent" }
    });
    if (!response.ok) throw new Error(`Erro ao buscar legendas (${response.status})`);

    const subtitles = await response.json();
    if (!subtitles || !Array.isArray(subtitles) || subtitles.length === 0)
      throw new Error("Nenhuma legenda encontrada no OpenSubtitles.");

    const bestSub = subtitles.find(s => s.SubDownloadLink?.endsWith(".gz") || s.SubDownloadLink?.endsWith(".srt")) || subtitles[0];
    const subUrl = bestSub.SubDownloadLink.replace(".gz", "");
    console.log("🎯 Legenda encontrada:", subUrl);

    // 4️⃣ Baixar legenda original
    const originalText = await (await fetch(subUrl)).text();

    // 5️⃣ Traduzir legenda
    console.log("🌐 Traduzindo legenda para PT-BR...");
    const { text: translated } = await translate(originalText, { from: "en", to: "pt" });

    // 6️⃣ Salvar em cache .srt puro
    await fs.writeFile(cachePath, translated, "utf8");
    console.log("💾 Legenda traduzida salva em cache:", cacheName);

    // 7️⃣ Retornar metadados ao Stremio
    res.json([
      {
        id: imdbId,
        url: cacheUrl,
        lang: "Portuguese",
        langcode: "pt",
        filename: `${imdbId}.pt.srt`
      }
    ]);
  } catch (err) {
    console.error("❌ Erro geral:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- SERVIR LEGENDAS EM CACHE ---
app.use("/cache", express.static(CACHE_DIR));

// --- HOME ---
app.get("/", (req, res) => {
  res.send("✅ Auto Translate RDG está ativo e funcionando!");
});

// --- INICIAR SERVIDOR ---
app.listen(PORT, () => {
  console.log(`🚀 Servidor iniciado na porta ${PORT}`);
});
