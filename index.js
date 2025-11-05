import express from "express";
import fetch from "node-fetch";
import fs from "fs-extra";
import path from "path";
import cors from "cors";
import morgan from "morgan";
import { fileURLToPath } from "url";
import translate from "google-translate-api-x";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(morgan("dev"));

const subtitlesDir = path.join(__dirname, "subtitles");
await fs.ensureDir(subtitlesDir);

// =======================
// Função para obter legenda original do OpenSubtitles
// =======================
async function getSubtitle(imdbId) {
  const cleanId = imdbId.replace("tt", "");
  const url = `https://rest.opensubtitles.org/search/imdbid-${cleanId}/sublanguageid-eng`;
  console.log(`[${new Date().toISOString()}] Buscando legendas originais: ${url}`);

  const response = await fetch(url, {
    headers: { "User-Agent": "TemporaryUserAgent" },
  });

  if (!response.ok)
    throw new Error(`Erro HTTP ${response.status}: ${response.statusText}`);

  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0)
    throw new Error("Nenhuma legenda encontrada no OpenSubtitles.");

  const subUrl = data[0].SubDownloadLink?.replace(".gz", "");
  if (!subUrl) throw new Error("Link da legenda inválido.");

  console.log(`[${new Date().toISOString()}] Link da legenda encontrado: ${subUrl}`);

  const subRes = await fetch(subUrl);
  const buffer = await subRes.arrayBuffer();
  return Buffer.from(buffer).toString("utf-8");
}

// =======================
// Traduz legenda (com blocos paralelos de até 5000 chars)
// =======================
async function translateSubtitle(content, targetLang = "pt") {
  const lines = content.split("\n");
  const blocks = [];
  let temp = "";

  for (const line of lines) {
    if (temp.length + line.length < 4500) {
      temp += line + "\n";
    } else {
      blocks.push(temp);
      temp = line + "\n";
    }
  }
  if (temp) blocks.push(temp);

  console.log(`Traduzindo ${blocks.length} blocos (${lines.length} linhas totais)...`);

  let translated = new Array(blocks.length).fill("");

  // 🔹 Função auxiliar para processar blocos em lotes
  async function processBatch(start, end) {
    const batch = blocks.slice(start, end).map(async (block, i) => {
      const index = start + i;
      try {
        const res = await translate(block, { to: targetLang });
        translated[index] = res.text;
        console.log(`✔️ Bloco ${index + 1}/${blocks.length} traduzido`);
      } catch (err) {
        console.error(`❌ Erro no bloco ${index + 1}:`, err.message);
        translated[index] = block; // mantém original em caso de falha
      }
    });
    await Promise.allSettled(batch);
  }

  // 🔹 Executa 4 blocos em paralelo
  const batchSize = 4;
  for (let i = 0; i < blocks.length; i += batchSize) {
    await processBatch(i, i + batchSize);
  }

  return translated.join("\n");
}

// =======================
// Manifest do addon
// =======================
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "auto-translate-rdg",
    version: "1.0.0",
    name: "Auto Translate RDG",
    description: "Addon que traduz legendas automaticamente para PT-BR",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [],
  });
});

// =======================
// Rota de legendas
// =======================
app.get("/subtitles/:type/:imdbId.json", async (req, res) => {
  const { imdbId } = req.params;
  const targetLang = req.query.lang || "pt";
  const cleanId = imdbId.replace("tt", "");
  const cachePath = path.join(subtitlesDir, `${cleanId}_${targetLang}.srt`);

  console.log(`[${new Date().toISOString()}] Nova requisição -> type: ${req.params.type}, imdb: ${imdbId}`);

  try {
    if (await fs.pathExists(cachePath)) {
      console.log(`✅ Cache encontrado para ${imdbId}`);
    } else {
      const original = await getSubtitle(imdbId);
      console.log(`[${new Date().toISOString()}] Legenda original obtida (${original.length} bytes)`);

      const translated = await translateSubtitle(original, targetLang);
      await fs.writeFile(cachePath, translated, "utf-8");
      console.log(`[${new Date().toISOString()}] Legenda traduzida salva: ${path.basename(cachePath)}`);
    }

    const body = [
      {
        id: `${imdbId}:${targetLang}`,
        url: `${req.protocol}://${req.get("host")}/subtitles/file/${cleanId}_${targetLang}.srt`,
        lang: targetLang,
        name: `Auto-Translated (${targetLang.toUpperCase()})`,
      },
    ];

    res.json({ subtitles: body });
  } catch (err) {
    console.error("❌ Erro geral:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =======================
// Rota para servir arquivo SRT
// =======================
app.get("/subtitles/file/:file", async (req, res) => {
  const file = path.join(subtitlesDir, req.params.file);
  if (await fs.pathExists(file)) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    fs.createReadStream(file).pipe(res);
  } else {
    res.status(404).send("Arquivo não encontrado");
  }
});

// =======================
// Iniciar servidor
// =======================
app.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});
