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

// Middleware CORS (igual ao seu)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// Substitui o morgan por console.log simples
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

const subtitlesDir = path.join(__dirname, "subtitles");
if (!fs.existsSync(subtitlesDir)) {
  fs.mkdirSync(subtitlesDir, { recursive: true });
}

// =======================
// Função para obter legenda original do OpenSubtitles (EXATAMENTE IGUAL)
// =======================
async function getSubtitle(imdbId, season, episode) {
  const cleanId = imdbId.replace("tt", "").split(":")[0];
  
  // 🔧 ADAPTAÇÃO: Constrói URL correta para séries
  let url;
  if (season && episode) {
    url = `https://rest.opensubtitles.org/search/imdbid-${cleanId}/season-${season}/episode-${episode}/sublanguageid-eng`;
    console.log(`[${new Date().toISOString()}] Buscando série: IMDB:${cleanId} S${season}E${episode}`);
  } else {
    url = `https://rest.opensubtitles.org/search/imdbid-${cleanId}/sublanguageid-eng`;
    console.log(`[${new Date().toISOString()}] Buscando filme: IMDB:${cleanId}`);
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

    const subUrl = data[0].SubDownloadLink?.replace(".gz", "");

    if (!subUrl) throw new Error("Link da legenda inválido.");

    console.log(`[${new Date().toISOString()}] Link da legenda encontrado: ${subUrl}`);

    const subRes = await fetch(subUrl);

    if (!subRes.ok)
      throw new Error(`Falha ao baixar legenda: ${subRes.statusText}`);

    const buffer = await subRes.arrayBuffer();
    return Buffer.from(buffer).toString("utf-8");
  } catch (err) {
    console.error("❌ Erro ao buscar legenda:", err.message);
    throw err;
  }
}

// =======================
// Traduz legenda (com blocos de até 4500 chars) - EXATAMENTE IGUAL
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

  console.log(
    `Traduzindo ${blocks.length} blocos (${lines.length} linhas totais)...`
  );

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
        translated[index] = block; // Em caso de erro, mantém o bloco original
      }
    });
    await Promise.allSettled(batch);
  }

  const batchSize = 4; // Processa 4 blocos por vez
  for (let i = 0; i < blocks.length; i += batchSize) {
    await processBatch(i, i + batchSize);
  }

  return translated.join("\n");
}

// =======================
// Manifest do addon - ATUALIZADO para versão nova
// =======================
app.get("/manifest.json", (req, res) => {
  const manifest = {
    id: "org.rdga.auto-translate",
    version: "1.2.0",
    name: "Auto Translate Subtitles",
    description: "Traduz legendas automaticamente para PT-BR",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [],
    behaviorHints: {
      configurable: false,
      configurationRequired: false
    }
  };
  res.json(manifest);
});

// =======================
// Rota para filmes - NOVO formato Stremio
// =======================
app.get("/subtitles/movie/:imdbId/:filename", async (req, res) => {
  const { imdbId } = req.params;
  const targetLang = "pt";
  
  // Gera cachePath baseado no IMDB ID
  const cleanId = imdbId.replace("tt", "");
  const cachePath = path.join(subtitlesDir, `movie-${cleanId}_${targetLang}.srt`);

  console.log(
    `[${new Date().toISOString()}] 🔹 FILME requisitado -> imdb: ${imdbId}`
  );

  try {
    if (!fs.existsSync(cachePath)) {
      console.log("🕐 Nenhum cache encontrado. Buscando e traduzindo...");
      const original = await getSubtitle(imdbId);
      const translated = await translateSubtitle(original, targetLang);
      fs.writeFileSync(cachePath, translated, "utf-8");
      console.log(
        `💾 Legenda traduzida salva em cache: ${path.basename(cachePath)}`
      );
    } else {
      console.log(`✅ Cache existente para ${imdbId}`);
    }

    // Serve o arquivo SRT diretamente
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(fs.readFileSync(cachePath, "utf8"));
    
  } catch (err) {
    console.error("❌ Erro geral:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =======================
// Rota para séries - NOVO formato Stremio
// =======================
app.get("/subtitles/series/:id/:filename", async (req, res) => {
  const partes = req.params.id.split(":");
  
  if (partes.length < 3) {
    return res.status(400).json({ error: "Formato inválido. Use: tt123456:season:episode" });
  }

  const imdbId = partes[0];
  const season = partes[1];
  const episode = partes[2];
  const targetLang = "pt";
  
  // Gera cachePath único para a série + temporada + episódio
  const cleanId = imdbId.replace("tt", "");
  const cachePath = path.join(subtitlesDir, `series-${cleanId}-s${season}e${episode}_${targetLang}.srt`);

  console.log(
    `[${new Date().toISOString()}] 🔹 SÉRIE requisitada -> ${imdbId} S${season}E${episode}`
  );

  try {
    if (!fs.existsSync(cachePath)) {
      console.log("🕐 Nenhum cache encontrado. Buscando e traduzindo...");
      const original = await getSubtitle(imdbId, season, episode);
      const translated = await translateSubtitle(original, targetLang);
      fs.writeFileSync(cachePath, translated, "utf-8");
      console.log(
        `💾 Legenda traduzida salva em cache: ${path.basename(cachePath)}`
      );
    } else {
      console.log(`✅ Cache existente para ${imdbId} S${season}E${episode}`);
    }

    // Serve o arquivo SRT diretamente
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(fs.readFileSync(cachePath, "utf8"));
    
  } catch (err) {
    console.error("❌ Erro geral:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =======================
// Rota para servir o arquivo SRT traduzido (mantida para compatibilidade)
// =======================
app.get("/subtitles/file/:file", async (req, res) => {
  const file = path.join(subtitlesDir, req.params.file);

  if (fs.existsSync(file)) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(fs.readFileSync(file, "utf8"));
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
// Health check para Render.com
// =======================
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// =======================
// Inicializa servidor
// =======================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor iniciado na porta ${PORT}`);
  console.log(`📋 Addon URL: https://auto-translate-rdg.onrender.com/manifest.json`);
});
