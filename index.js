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

// API key do OpenSubtitles
const OPENSUBTITLES_API_KEY = process.env.OPENSUBTITLES_API_KEY || "";

if (!OPENSUBTITLES_API_KEY) {
  console.warn("⚠️ AVISO: OPENSUBTITLES_API_KEY não configurada!");
}

app.use(cors());
app.use(morgan("dev"));

const subtitlesDir = path.join(__dirname, "subtitles");
await fs.ensureDir(subtitlesDir);

// =======================
// Função para obter legenda do OpenSubtitles (Nova API v1)
// =======================
async function getSubtitle(imdbId, type = "movie", season = null, episode = null) {
  const cleanId = imdbId.replace("tt", "").split(":")[0];
  
  let searchParams = new URLSearchParams({
    imdb_id: cleanId,
    languages: "en",
  });
  
  if (type === "series" && season && episode) {
    searchParams.append("type", "episode");
    searchParams.append("season_number", season);
    searchParams.append("episode_number", episode);
  } else {
    searchParams.append("type", "movie");
  }
  
  const url = `https://api.opensubtitles.com/api/v1/subtitles?${searchParams}`;
  
  console.log(`[${new Date().toISOString()}] Buscando legendas: ${url}`);
  
  try {
    const response = await fetch(url, {
      headers: {
        "Api-Key": OPENSUBTITLES_API_KEY,
        "User-Agent": "StremioAutoTranslateRDG v1.0",
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Erro HTTP ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    
    if (!data.data || data.data.length === 0) {
      throw new Error("Nenhuma legenda encontrada no OpenSubtitles.");
    }
    
    const bestSub = data.data.sort((a, b) => 
      (b.attributes.ratings || 0) - (a.attributes.ratings || 0)
    )[0];
    
    const fileId = bestSub.attributes.files[0].file_id;
    
    console.log(`[${new Date().toISOString()}] FileID encontrado: ${fileId}`);
    
    const downloadUrl = `https://api.opensubtitles.com/api/v1/download`;
    
    const downloadResponse = await fetch(downloadUrl, {
      method: "POST",
      headers: {
        "Api-Key": OPENSUBTITLES_API_KEY,
        "Content-Type": "application/json",
        "User-Agent": "StremioAutoTranslateRDG v1.0",
      },
      body: JSON.stringify({ file_id: fileId }),
    });
    
    if (!downloadResponse.ok) {
      throw new Error(`Falha no download: ${downloadResponse.statusText}`);
    }
    
    const downloadData = await downloadResponse.json();
    const subtitleUrl = downloadData.link;
    
    console.log(`[${new Date().toISOString()}] Download link: ${subtitleUrl}`);
    
    const subRes = await fetch(subtitleUrl);
    if (!subRes.ok) {
      throw new Error(`Falha ao baixar arquivo: ${subRes.statusText}`);
    }
    
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
    description: "Traduz legendas automaticamente para PT-BR (Filmes e Séries)",
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
  const { type, imdbId } = req.params;
  const targetLang = req.query.lang || "pt";
  
  const idParts = imdbId.split(":");
  const cleanId = idParts[0].replace("tt", "");
  const season = idParts[1] || null;
  const episode = idParts[2] || null;
  
  const cacheKey = season && episode 
    ? `${cleanId}_S${season}E${episode}_${targetLang}`
    : `${cleanId}_${targetLang}`;
  
  const cachePath = path.join(subtitlesDir, `${cacheKey}.srt`);
  
  console.log(`[${new Date().toISOString()}] 🔹 Requisição -> ${type} | IMDB: ${imdbId} | S${season}E${episode}`);
  
  try {
    if (!(await fs.pathExists(cachePath))) {
      console.log(`🕐 Nenhum cache encontrado. Buscando e traduzindo...`);
      
      const original = await getSubtitle(
        `tt${cleanId}`,
        type,
        season,
        episode
      );
      
      const translated = await translateSubtitle(original, targetLang);
      await fs.writeFile(cachePath, translated, "utf-8");
      
      console.log(`💾 Legenda traduzida salva em cache: ${path.basename(cachePath)}`);
    } else {
      console.log(`✅ Cache existente para ${cacheKey}`);
    }
    
    const body = [
      {
        id: `${imdbId}:${targetLang}`,
        url: `${req.protocol}://${req.get("host")}/subtitles/file/${cacheKey}.srt`,
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
// Health check para Render
// =======================
app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// =======================
// Página inicial
// =======================
app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Auto Translate RDG</title>
      <style>
        body { 
          font-family: Arial, sans-serif; 
          max-width: 800px; 
          margin: 50px auto; 
          padding: 20px;
          background: #f5f5f5;
        }
        .container {
          background: white;
          padding: 30px;
          border-radius: 10px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 { color: #333; }
        .status { color: #28a745; font-weight: bold; }
        code { 
          background: #f4f4f4; 
          padding: 2px 6px; 
          border-radius: 3px;
          font-size: 14px;
        }
        a { color: #007bff; text-decoration: none; }
        a:hover { text-decoration: underline; }
        ul { line-height: 1.8; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🎬 Auto Translate RDG</h1>
        <p class="status">✅ Addon rodando com sucesso!</p>
        
        <h3>📋 Informações:</h3>
        <ul>
          <li><strong>Porta:</strong> ${PORT}</li>
          <li><strong>Status API:</strong> ${OPENSUBTITLES_API_KEY ? '✅ Configurada' : '❌ Não configurada'}</li>
          <li><strong>Manifest:</strong> <a href="/manifest.json">/manifest.json</a></li>
          <li><strong>Health Check:</strong> <a href="/health">/health</a></li>
        </ul>
        
        <h3>🚀 Como Usar no Stremio:</h3>
        <ol>
          <li>Copie a URL: <code>${req.protocol}://${req.get("host")}/manifest.json</code></li>
          <li>Abra o Stremio</li>
          <li>Vá em <strong>Addons → Community Addons</strong></li>
          <li>Cole a URL e instale</li>
          <li>Aproveite as legendas traduzidas!</li>
        </ol>
      </div>
    </body>
    </html>
  `);
});

// =======================
// Inicializa servidor
// =======================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor iniciado na porta ${PORT}`);
  console.log(`📝 Manifest: http://localhost:${PORT}/manifest.json`);
  console.log(`💚 Health: http://localhost:${PORT}/health`);
});
