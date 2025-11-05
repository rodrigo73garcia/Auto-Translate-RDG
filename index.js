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
  const parts = imdbId.replace("tt", "").split(":");
  const cleanId = parts[0];
  const season = parts[1];
  const episode = parts[2];

  // ✅ URL corrigido com ordem e formato corretos
  let url;
  if (season && episode) {
    url = `https://rest.opensubtitles.org/search/imdbid-${cleanId}/season-${season}/episode-${episode}/sublanguageid-eng`;
  } else {
    url = `https://rest.opensubtitles.org/search/imdbid-${cleanId}/sublanguageid-eng`;
  }

  console.log(`[${new Date().toISOString()}] Buscando legendas originais: ${url}`);

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "TemporaryUserAgent" },
    });

    if (!response.ok)
      throw new Error(`Erro HTTP ${response.status}: ${response.statusText}`);

    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0)
      throw new Error("Nenhuma legenda encontrada no OpenSubtitles.");

    // Pega a legenda com maior número de downloads (melhor correspondência)
    const best = data.sort((a, b) => (b.SubDownloadsCnt || 0) - (a.SubDownloadsCnt || 0))[0];
    const subUrl = best.SubDownloadLink?.replace(".gz", "");
    if (!subUrl) throw new Error("Link da legenda inválido.");

    console.log(`[${new Date().toISOString()}] Link da legenda encontrado: ${subUrl}`);

    const subRes = await fetch(subUrl);
    if (!subRes.ok) throw new Error(`Falha ao baixar legenda: ${subRes.statusText}`);
    const buffer = await subRes.arrayBuffer();

    return Buffer.from(buffer).toString("utf-8");
  } catch (err) {
    console.error("❌ Erro ao buscar legenda:", err.message);
    throw err;
  }
}

// =======================
// Traduz legenda (com blocos de até 4500 chars)
// =======================
async function translateSubtitle(content, targetLang = "pt") {
  const lines = content.split("\n");
  const blocks = [];
  let temp = "";

  for (const line of lines) {
    if (temp.length + line.length < 4500) temp += line + "\n";
    else {
      blocks.push(temp);
      temp = line + "\n";
    }
  }
  if (temp) blocks.push(temp);

  console.log(`Traduzindo ${blocks.length} blocos (${lines.length} linhas totais)...`);

  let translated = new Array(blocks.length).fill("");

  async function processBatch(start, end) {
    const batch = blocks.slice(start, end).map(async (block, i) => {
      const index = start + i;
      try {
        const res = await translate(block, { to: targetLang });
        translated[index] = res.text;
        console.log(`✔️ Bloco ${index + 1}/${blocks.length} traduzido`);
      } catch (err) {
        console.error(`❌ Erro no bloco ${index + 1}:`, err.message);
        translated[index] = block;
      }
    });
    await Promise.allSettled(batch);
  }

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
  const manifest = {
    id: "org.rdg.autotranslate",
    version: "1.0.0",
    name: "Auto Translate RDG",
    description: "Traduz legendas automaticamente para PT-BR",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [],
  };
  res.json(manifest);
});

// =======================
// Rota principal de legendas
// =======================
app.get("/subtitles/:type/:imdbId*.json", async (req, res) => {
  const { imdbId } = req.params;
  const targetLang = req.query.lang || "pt";
  const cleanId = imdbId.replace("tt", "").replace(/:/g, "_");
  const cachePath = path.join(subtitlesDir, `${cleanId}_${targetLang}.srt`);

  console.log(`[${new Date().toISOString()}] 🔹 Requisição recebida -> imdb: ${imdbId}`);

  try {
    if (!(await fs.pathExists(cachePath))) {
      console.log(`🕐 Nenhum cache encontrado. Buscando e traduzindo...`);
      const original = await getSubtitle(imdbId);
      const translated = await translateSubtitle(original, targetLang);
      await fs.writeFile(cachePath, translated, "utf-8");
      console.log(`💾 Legenda traduzida salva em cache: ${path.basename(cachePath)}`);
    } else {
      console.log(`✅ Cache existente para ${imdbId}`);
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
// Rota para servir o arquivo SRT traduzido
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
// Teste rápido (homepage simples)
// =======================
app.get("/", (req, res) => {
  res.send("✅ Addon Auto-Translate RDG está rodando. Acesse /manifest.json");
});

// =======================
// Inicializa servidor
// =======================
app.listen(PORT, () => {
  console.log(`🚀 Servidor iniciado na porta ${PORT}`);
});
