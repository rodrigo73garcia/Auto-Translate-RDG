import express from "express";
import cors from "cors";
import morgan from "morgan";
import compression from "compression";
import fs from "fs-extra";
import path from "path";
import fetch from "node-fetch";
import { translate } from "google-translate-api-x";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(morgan("dev"));
app.use(compression());
app.use(express.json());

// =====================
// 🔹 Configurações
// =====================
const OPEN_SUBTITLES_URL = "https://rest.opensubtitles.org/search";
const USER_AGENT = "TemporaryUserAgent";
const CACHE_DIR = "./cache";
await fs.ensureDir(CACHE_DIR);

// =====================
// 🔹 Manifesto do Addon
// =====================
const manifest = {
  id: "auto-translate-rdg",
  version: "1.0.0",
  name: "Auto Translate RDG",
  description: "Addon que traduz legendas automaticamente para o português",
  types: ["movie", "series"],
  catalogs: [],
  resources: ["subtitles"],
};

// =====================
// 🔹 Rotas básicas
// =====================
app.get("/", (req, res) => res.send("API Auto Translate RDG online ✅"));
app.get("/test", (req, res) => res.json({ status: "✅ online", time: new Date() }));

// =====================
// 🔹 Manifesto (Stremio)
// =====================
app.get("/manifest.json", (req, res) => {
  res.json(manifest);
});

// =====================
// 🔹 Rota principal: /subtitles/:type/:imdbid
// =====================
app.get("/subtitles/:type/:imdbid", async (req, res) => {
  const { type, imdbid } = req.params;
  const lang = req.query.lang || "pt";
  const cleanId = imdbid.replace(".json", "");

  console.log(`[${new Date().toISOString()}] Nova requisição -> type: ${type}, imdb: ${cleanId}`);

  try {
    const cachePath = path.join(CACHE_DIR, `${type}_${cleanId}_${lang}.srt`);

    // Se já existir legenda traduzida no cache, retorna
    if (await fs.pathExists(cachePath)) {
      console.log(`Legenda traduzida já em cache: ${cachePath}`);
      const srt = await fs.readFile(cachePath, "utf8");
      return res.json([
        {
          id: `${lang}-${cleanId}`,
          url: `${req.protocol}://${req.get("host")}/${cachePath.replace("./", "")}`,
          lang: "Português (BR)",
          langcode: lang,
        },
      ]);
    }

    // Buscar legenda original no OpenSubtitles
    const response = await fetch(`${OPEN_SUBTITLES_URL}/imdbid-${cleanId}/sublanguageid-eng`, {
      headers: { "User-Agent": USER_AGENT },
    });

    const subtitles = await response.json();
    if (!Array.isArray(subtitles) || subtitles.length === 0)
      throw new Error("Nenhuma legenda encontrada no OpenSubtitles.");

    const sub = subtitles[0];
    const downloadUrl = sub.url || sub.SubDownloadLink;
    const original = await fetch(downloadUrl);
    const srtText = await original.text();

    console.log(`[${new Date().toISOString()}] Legenda original obtida (${srtText.length} bytes)`);

    // Traduzir legenda em blocos
    const lines = srtText.split("\n");
    const blocks = [];
    const blockSize = 200;
    for (let i = 0; i < lines.length; i += blockSize) {
      blocks.push(lines.slice(i, i + blockSize).join("\n"));
    }

    console.log(`Traduzindo ${blocks.length} blocos (${lines.length} linhas totais)...`);

    let translated = "";

    for (let i = 0; i < blocks.length; i++) {
      const blockFile = path.join(CACHE_DIR, `${type}_${cleanId}_${lang}_part${i}.srt`);
      if (await fs.pathExists(blockFile)) {
        translated += await fs.readFile(blockFile, "utf8") + "\n";
        console.log(`✔️ Bloco ${i + 1} já traduzido`);
        continue;
      }

      const result = await translate(blocks[i], { to: lang, forceTo: true });
      await fs.writeFile(blockFile, result.text);
      translated += result.text + "\n";
      console.log(`✔️ Bloco ${i + 1} traduzido`);
    }

    await fs.writeFile(cachePath, translated);
    console.log(`[${new Date().toISOString()}] Legenda traduzida salva: ${path.basename(cachePath)}`);

    // Retorna formato compatível com Stremio
    res.json([
      {
        id: `${lang}-${cleanId}`,
        lang: "Português (BR)",
        langcode: lang,
        url: `${req.protocol}://${req.get("host")}/${cachePath.replace("./", "")}`,
      },
    ]);
  } catch (err) {
    console.error("Erro na rota:", err);
    res.status(500).json({ error: err.message || "Erro ao processar legenda." });
  }
});

// =====================
// 🔹 Servir arquivos de legenda traduzidos
// =====================
app.use("/cache", express.static("cache"));

app.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});
