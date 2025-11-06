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

// Middleware CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// Log simples
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

const subtitlesDir = path.join(__dirname, "subtitles");
if (!fs.existsSync(subtitlesDir)) {
  fs.mkdirSync(subtitlesDir, { recursive: true });
}

// =======================
// Função para obter legenda original do OpenSubtitles - URL CORRIGIDA
// =======================
async function getSubtitle(imdbId, season, episode) {
  const cleanId = imdbId.replace("tt", "").split(":")[0];
  
  // 🔧 CORREÇÃO: URL correta para OpenSubtitles
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
// Traduz legenda COM PROTECÇÃO CONTRA RATE LIMITING
// =======================
async function translateSubtitle(content, targetLang = "pt") {
  const lines = content.split("\n");
  const blocks = [];
  let temp = "";

  // Agrupa em blocos (mesma lógica)
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

  // 🔧 CORREÇÃO: Tradução SEQUENCIAL com delays para evitar rate limiting
  for (let i = 0; i < blocks.length; i++) {
    try {
      console.log(`🌐 Traduzindo bloco ${i + 1}/${blocks.length}...`);
      
      const res = await translate(blocks[i], { to: targetLang });
      translated[i] = res.text;
      console.log(`✅ Bloco ${i + 1}/${blocks.length} traduzido`);
      
      // ⏰ DELAY entre blocos - CRÍTICO para evitar rate limiting
      if (i < blocks.length - 1) {
        const delay = 1000 + Math.random() * 1000; // 1-2 segundos entre blocos
        console.log(`⏳ Aguardando ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
    } catch (err) {
      console.error(`❌ Erro no bloco ${i + 1}:`, err.message);
      translated[i] = blocks[i]; // Mantém original em caso de erro
      
      // ⏰ Delay maior em caso de erro
      const errorDelay = 3000 + Math.random() * 2000; // 3-5 segundos
      console.log(`🚫 Erro detectado, aguardando ${Math.round(errorDelay)}ms...`);
      await new Promise(resolve => setTimeout(resolve, errorDelay));
    }
  }

  return translated.join("\n");
}

// =======================
// Manifest do addon
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
// Rota para filmes
// =======================
app.get("/subtitles/movie/:imdbId/:filename", async (req, res) => {
  const { imdbId } = req.params;
  const targetLang = "pt";
  
  const cleanId = imdbId.replace("tt", "");
  const cachePath = path.join(subtitlesDir, `movie-${cleanId}_${targetLang}.srt`);

  console.log(`[${new Date().toISOString()}] 🔹 FILME requisitado -> imdb: ${imdbId}`);

  try {
    if (!fs.existsSync(cachePath)) {
      console.log("🕐 Nenhum cache encontrado. Buscando e traduzindo...");
      const original = await getSubtitle(imdbId);
      const translated = await translateSubtitle(original, targetLang);
      fs.writeFileSync(cachePath, translated, "utf-8");
      console.log(`💾 Legenda salva em cache: ${path.basename(cachePath)}`);
    } else {
      console.log(`✅ Cache existente para ${imdbId}`);
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(fs.readFileSync(cachePath, "utf8"));
    
  } catch (err) {
    console.error("❌ Erro geral:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =======================
// Rota para séries - COM DECODIFICAÇÃO URL
// =======================
app.get("/subtitles/series/:id/:filename", async (req, res) => {
  try {
    // 🔧 CORREÇÃO: Decodifica URL parameters
    const decodedId = decodeURIComponent(req.params.id);
    const partes = decodedId.split(":");
    
    if (partes.length < 3) {
      return res.status(400).json({ error: "Formato inválido. Use: tt123456:season:episode" });
    }

    const imdbId = partes[0];
    const season = partes[1];
    const episode = partes[2];
    const targetLang = "pt";
    
    const cleanId = imdbId.replace("tt", "");
    const cachePath = path.join(subtitlesDir, `series-${cleanId}-s${season}e${episode}_${targetLang}.srt`);

    console.log(`[${new Date().toISOString()}] 🔹 SÉRIE requisitada -> ${imdbId} S${season}E${episode}`);

    if (!fs.existsSync(cachePath)) {
      console.log("🕐 Nenhum cache encontrado. Buscando e traduzindo...");
      const original = await getSubtitle(imdbId, season, episode);
      const translated = await translateSubtitle(original, targetLang);
      fs.writeFileSync(cachePath, translated, "utf-8");
      console.log(`💾 Legenda salva em cache: ${path.basename(cachePath)}`);
    } else {
      console.log(`✅ Cache existente para ${imdbId} S${season}E${episode}`);
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(fs.readFileSync(cachePath, "utf8"));
    
  } catch (err) {
    console.error("❌ Erro rota série:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =======================
// Rota para servir arquivo SRT
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
// Rotas auxiliares
// =======================
app.get("/", (req, res) => {
  res.send("✅ Addon Auto-Translate RDG está rodando. Acesse /manifest.json");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// =======================
// Inicialização
// =======================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor iniciado na porta ${PORT}`);
  console.log(`📋 Addon URL: https://auto-translate-rdg.onrender.com/manifest.json`);
});
