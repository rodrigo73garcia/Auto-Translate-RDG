import express from "express";
import fetch from "node-fetch";
import fs from "fs-extra";
import path from "path";
import cors from "cors";
import morgan from "morgan";
import { fileURLToPath } from "url";
import translate from "google-translate-api-x";
import { v4 as uuidv4 } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const subtitlesDir = path.join(__dirname, "subtitles");
const configDir = path.join(__dirname, "config-data");
const publicDir = path.join(__dirname, "public");

await fs.ensureDir(subtitlesDir);
await fs.ensureDir(configDir);
await fs.ensureDir(publicDir);

// =======================
// Funções de Configuração
// =======================

async function saveConfig(apiKey, targetLang) {
  const id = uuidv4();
  const configPath = path.join(configDir, `${id}.json`);
  
  await fs.writeJson(configPath, {
    id,
    apiKey,
    targetLang,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 dias
  });
  
  return id;
}

async function loadConfig(id) {
  const configPath = path.join(configDir, `${id}.json`);
  
  if (!await fs.pathExists(configPath)) {
    return null;
  }
  
  const config = await fs.readJson(configPath);
  
  // Verifica se expirou
  if (new Date(config.expiresAt) < new Date()) {
    await fs.remove(configPath);
    return null;
  }
  
  return config;
}

// =======================
// API Endpoints para Configuração
// =======================

app.post("/api/config", async (req, res) => {
  try {
    const { apiKey, targetLang } = req.body;
    
    if (!apiKey || !targetLang) {
      return res.status(400).json({ error: "API key e idioma são obrigatórios" });
    }
    
    const id = await saveConfig(apiKey, targetLang);
    
    res.json({
      success: true,
      configId: id,
      manifestUrl: `${req.protocol}://${req.get("host")}/manifest.json?config=${id}`,
    });
  } catch (err) {
    console.error("❌ Erro ao salvar config:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/languages", (req, res) => {
  const languages = {
    pt: "Português (Brasil)",
    en: "English",
    es: "Español",
    fr: "Français",
    de: "Deutsch",
    it: "Italiano",
    ja: "日本語",
    ko: "한국어",
    zh: "中文",
    ru: "Русский",
    tr: "Türkçe",
    pl: "Polski",
    nl: "Nederlands",
    sv: "Svenska",
    da: "Dansk",
  };
  
  res.json(languages);
});

// =======================
// Função para obter legenda (com fallback)
// =======================

async function getSubtitleNewAPI(imdbId, apiKey, type = "movie", season = null, episode = null) {
  if (!apiKey) {
    throw new Error("API key não disponível");
  }
  
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
  
  const response = await fetch(url, {
    headers: {
      "Api-Key": apiKey,
      "User-Agent": "StremioAutoTranslateRDG v1.0",
    },
  });
  
  if (!response.ok) {
    throw new Error(`Nova API falhou ${response.status}`);
  }
  
  const data = await response.json();
  
  if (!data.data || data.data.length === 0) {
    throw new Error("Nenhuma legenda encontrada");
  }
  
  const bestSub = data.data.sort((a, b) => 
    (b.attributes.ratings || 0) - (a.attributes.ratings || 0)
  )[0];
  
  const fileId = bestSub.attributes.files[0].file_id;
  
  const downloadResponse = await fetch(`https://api.opensubtitles.com/api/v1/download`, {
    method: "POST",
    headers: {
      "Api-Key": apiKey,
      "Content-Type": "application/json",
      "User-Agent": "StremioAutoTranslateRDG v1.0",
    },
    body: JSON.stringify({ file_id: fileId }),
  });
  
  if (!downloadResponse.ok) {
    throw new Error(`Falha no download`);
  }
  
  const downloadData = await downloadResponse.json();
  const subRes = await fetch(downloadData.link);
  
  if (!subRes.ok) {
    throw new Error(`Falha ao baixar arquivo`);
  }
  
  const buffer = await subRes.arrayBuffer();
  return Buffer.from(buffer).toString("utf-8");
}

async function getSubtitleOldAPI(imdbId, type = "movie", season = null, episode = null) {
  const cleanId = imdbId.replace("tt", "").split(":")[0];
  
  let url = `https://rest.opensubtitles.org/search/imdbid-${cleanId}/sublanguageid-eng`;
  
  if (type === "series" && season && episode) {
    url += `/season-${season}/episode-${episode}`;
  }
  
  const response = await fetch(url, {
    headers: {
      "User-Agent": "TemporaryUserAgent",
    },
  });
  
  if (!response.ok) {
    throw new Error(`API Antiga falhou ${response.status}`);
  }
  
  const data = await response.json();
  
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Nenhuma legenda encontrada");
  }
  
  const subUrl = data[0].SubDownloadLink?.replace(".gz", "");
  if (!subUrl) {
    throw new Error("Link da legenda inválido");
  }
  
  const subRes = await fetch(subUrl);
  if (!subRes.ok) {
    throw new Error(`Falha ao baixar`);
  }
  
  const buffer = await subRes.arrayBuffer();
  return Buffer.from(buffer).toString("utf-8");
}

async function getSubtitle(imdbId, apiKey = null, type = "movie", season = null, episode = null) {
  if (apiKey) {
    try {
      console.log("🔄 Tentando Nova API...");
      return await getSubtitleNewAPI(imdbId, apiKey, type, season, episode);
    } catch (err) {
      console.warn(`⚠️ Nova API falhou: ${err.message}`);
    }
  }
  
  try {
    console.log("🔄 Tentando API Antiga (fallback)...");
    return await getSubtitleOldAPI(imdbId, type, season, episode);
  } catch (err) {
    console.error(`❌ API Antiga também falhou: ${err.message}`);
    throw new Error(`Ambas APIs falharam`);
  }
}

// =======================
// Traduz legenda
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
  
  console.log(`Traduzindo ${blocks.length} blocos...`);
  
  let translated = new Array(blocks.length).fill("");
  
  async function processBatch(start, end) {
    const batch = blocks.slice(start, end).map(async (block, i) => {
      const index = start + i;
      try {
        const res = await translate(block, { to: targetLang });
        translated[index] = res.text;
        console.log(`✔️ Bloco ${index + 1}/${blocks.length}`);
      } catch (err) {
        console.error(`❌ Erro bloco ${index + 1}`);
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
// Manifest Dinâmico
// =======================

app.get("/manifest.json", async (req, res) => {
  const { config: configId } = req.query;
  
  let apiKey = null;
  let name = "Auto Translate RDG";
  let description = "Traduz legendas automaticamente para PT-BR";
  
  if (configId) {
    const config = await loadConfig(configId);
    if (config) {
      apiKey = config.apiKey;
      name = `Auto Translate RDG (${config.targetLang.toUpperCase()})`;
      description = `Traduz legendas automaticamente para ${config.targetLang.toUpperCase()}`;
    }
  }
  
  const manifest = {
    id: "org.rdg.autotranslate",
    version: "1.0.0",
    name: name,
    description: description,
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [],
    contactEmail: "support@rdg.addon",
  };
  
  // Armazena a API key em sessão para uso posterior
  if (configId) {
    res.set("X-Config-Id", configId);
  }
  
  res.json(manifest);
});

// =======================
// Rota Principal de Legendas
// =======================

app.get("/subtitles/:type/:imdbId*.json", async (req, res) => {
  const { type, imdbId } = req.params;
  const { config: configId } = req.query;
  
  let apiKey = null;
  let targetLang = "pt";
  
  if (configId) {
    const config = await loadConfig(configId);
    if (config) {
      apiKey = config.apiKey;
      targetLang = config.targetLang;
    }
  }
  
  const idParts = imdbId.split(":");
  const cleanId = idParts[0].replace("tt", "");
  const season = idParts[1] || null;
  const episode = idParts[2] || null;
  
  const cacheKey = season && episode 
    ? `${cleanId}_S${season}E${episode}_${targetLang}`
    : `${cleanId}_${targetLang}`;
  
  const cachePath = path.join(subtitlesDir, `${cacheKey}.srt`);
  
  console.log(`[${new Date().toISOString()}] 🔹 ${type} | ${imdbId}`);
  
  try {
    if (!(await fs.pathExists(cachePath))) {
      console.log(`🕐 Buscando e traduzindo...`);
      
      const original = await getSubtitle(
        `tt${cleanId}`,
        apiKey,
        type,
        season,
        episode
      );
      
      const translated = await translateSubtitle(original, targetLang);
      await fs.writeFile(cachePath, translated, "utf-8");
      
      console.log(`💾 Legenda em cache`);
    } else {
      console.log(`✅ Cache encontrado`);
    }
    
    const manifestUrl = configId ? `?config=${configId}` : "";
    
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
    console.error("❌ Erro:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =======================
// Servir Arquivo de Legenda
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
// Health Check
// =======================

app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString()
  });
});

// =======================
// Inicializa Servidor
// =======================

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor iniciado na porta ${PORT}`);
  console.log(`📝 Configuração: ${new URL("http://localhost:" + PORT).href}config`);
});
