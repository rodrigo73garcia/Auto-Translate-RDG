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

// =======================
// Forçar HTTPS em produção
// =======================
app.use((req, res, next) => {
  if (req.headers["x-forwarded-proto"] !== "https" && process.env.NODE_ENV === "production") {
    return res.redirect(`https://${req.headers.host}${req.url}`);
  }
  next();
});

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
// Redirecionar /config para /config.html
// =======================
app.get("/config", (req, res) => {
  res.redirect("/config.html");
});

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
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 dias
  });
  
  return id;
}

async function loadConfig(id) {
  const configPath = path.join(configDir, `${id}.json`);
  
  if (!await fs.pathExists(configPath)) {
    return null;
  }
  
  const config = await fs.readJson(configPath);
  
  if (new Date(config.expiresAt) < new Date()) {
    await fs.remove(configPath);
    return null;
  }
  
  return config;
}

// =======================
// API Endpoints
// =======================

app.post("/api/config", async (req, res) => {
  try {
    const { apiKey, targetLang } = req.body;
    
    if (!apiKey || !targetLang) {
      return res.status(400).json({ error: "API key e idioma são obrigatórios" });
    }
    
    const id = await saveConfig(apiKey, targetLang);
    
    const protocol = req.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production" ? "https" : req.protocol;
    const manifestUrl = `${protocol}://${req.get("host")}/manifest.json?config=${id}`;
    
    res.json({
      success: true,
      configId: id,
      manifestUrl: manifestUrl,
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
    ar: "العربية",
    hi: "हिन्दी",
  };
  
  res.json(languages);
});

// =======================
// Função para obter legenda (SOMENTE NOVA API)
// =======================

async function getSubtitleFromOpenSubtitles(imdbId, apiKey, type = "movie", season = null, episode = null) {
  if (!apiKey) {
    throw new Error("API key do OpenSubtitles é obrigatória");
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
  
  console.log(`[${new Date().toISOString()}] 🔍 Buscando legendas: ${url}`);
  
  const response = await fetch(url, {
    headers: {
      "Api-Key": apiKey,
      "User-Agent": "StremioAutoTranslateRDG v1.0",
      "Content-Type": "application/json",
    },
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenSubtitles API erro ${response.status}: ${errorText}`);
  }
  
  const data = await response.json();
  
  if (!data.data || data.data.length === 0) {
    throw new Error("Nenhuma legenda em inglês encontrada no OpenSubtitles");
  }
  
  // Ordena por rating e pega a melhor
  const bestSub = data.data.sort((a, b) => 
    (b.attributes.ratings || 0) - (a.attributes.ratings || 0)
  )[0];
  
  if (!bestSub.attributes.files || bestSub.attributes.files.length === 0) {
    throw new Error("Legenda sem arquivo disponível");
  }
  
  const fileId = bestSub.attributes.files[0].file_id;
  
  console.log(`[${new Date().toISOString()}] 📥 Baixando legenda FileID: ${fileId}`);
  
  // Faz o download
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
    const errorText = await downloadResponse.text();
    throw new Error(`Erro no download: ${errorText}`);
  }
  
  const downloadData = await downloadResponse.json();
  
  if (!downloadData.link) {
    throw new Error("Link de download não disponível");
  }
  
  const subRes = await fetch(downloadData.link);
  
  if (!subRes.ok) {
    throw new Error(`Falha ao baixar arquivo da legenda: ${subRes.statusText}`);
  }
  
  const buffer = await subRes.arrayBuffer();
  const content = Buffer.from(buffer).toString("utf-8");
  
  console.log(`[${new Date().toISOString()}] ✅ Legenda baixada com sucesso (${content.length} chars)`);
  
  return content;
}

// =======================
// Função de Tradução com Retry e Delay
// =======================

async function translateSubtitle(content, targetLang = "pt") {
  const lines = content.split("\n");
  const blocks = [];
  let temp = "";
  
  // Divide em blocos menores para evitar timeout
  for (const line of lines) {
    if (temp.length + line.length < 3500) { // Reduzido para 3500
      temp += line + "\n";
    } else {
      if (temp.trim()) blocks.push(temp);
      temp = line + "\n";
    }
  }
  if (temp.trim()) blocks.push(temp);
  
  console.log(`[${new Date().toISOString()}] 🌐 Traduzindo ${blocks.length} blocos para ${targetLang}...`);
  
  let translated = [];
  
  // Processa blocos sequencialmente com delay para evitar rate limit
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        // Delay entre requisições (evita rate limit)
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
        }
        
        const res = await translate(block, { to: targetLang });
        translated.push(res.text);
        console.log(`✔️ Bloco ${i + 1}/${blocks.length} traduzido`);
        break; // Sucesso, sai do loop de retry
        
      } catch (err) {
        attempts++;
        console.warn(`⚠️ Erro no bloco ${i + 1} (tentativa ${attempts}/${maxAttempts}): ${err.message}`);
        
        if (attempts >= maxAttempts) {
          console.error(`❌ Bloco ${i + 1} falhou após ${maxAttempts} tentativas. Mantendo original.`);
          translated.push(block); // Mantém original se falhar
        } else {
          // Espera mais tempo antes de tentar novamente
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
  }
  
  console.log(`[${new Date().toISOString()}] ✅ Tradução concluída!`);
  
  return translated.join("\n");
}

// =======================
// Manifest Dinâmico
// =======================

app.get("/manifest.json", async (req, res) => {
  const { config: configId } = req.query;
  
  let name = "Auto Translate RDG";
  let description = "Traduz legendas automaticamente (requer configuração)";
  
  if (configId) {
    const config = await loadConfig(configId);
    if (config) {
      const langName = {
        pt: "Português",
        en: "English",
        es: "Español",
        fr: "Français",
        de: "Deutsch",
        it: "Italiano",
        ja: "日本語",
        ko: "한국어",
        zh: "中文",
        ru: "Русский",
      }[config.targetLang] || config.targetLang.toUpperCase();
      
      name = `Auto Translate → ${langName}`;
      description = `Tradução automática de legendas para ${langName}`;
    }
  }
  
  const manifest = {
    id: "org.rdg.autotranslate",
    version: "1.0.1",
    name: name,
    description: description,
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [],
    contactEmail: "support@rdg.addon",
    logo: "https://i.imgur.com/placeholder.png",
  };
  
  res.json(manifest);
});

// =======================
// Rota Principal de Legendas
// =======================

app.get("/subtitles/:type/:imdbId*.json", async (req, res) => {
  const { type, imdbId } = req.params;
  const { config: configId } = req.query;
  
  console.log(`[${new Date().toISOString()}] 🔹 Requisição: ${type} | ${imdbId} | config: ${configId}`);
  
  if (!configId) {
    return res.status(400).json({ 
      error: "Configuração não fornecida. Acesse /config para configurar sua API key." 
    });
  }
  
  const config = await loadConfig(configId);
  
  if (!config) {
    return res.status(400).json({ 
      error: "Configuração inválida ou expirada. Por favor, reconfigure em /config" 
    });
  }
  
  const apiKey = config.apiKey;
  const targetLang = config.targetLang;
  
  const idParts = imdbId.split(":");
  const cleanId = idParts[0].replace("tt", "");
  const season = idParts[1] || null;
  const episode = idParts[2] || null;
  
  const cacheKey = season && episode 
    ? `${cleanId}_S${season}E${episode}_${targetLang}`
    : `${cleanId}_${targetLang}`;
  
  const cachePath = path.join(subtitlesDir, `${cacheKey}.srt`);
  
  try {
    if (!(await fs.pathExists(cachePath))) {
      console.log(`🕐 Cache não encontrado. Buscando e traduzindo...`);
      
      const original = await getSubtitleFromOpenSubtitles(
        `tt${cleanId}`,
        apiKey,
        type,
        season,
        episode
      );
      
      const translated = await translateSubtitle(original, targetLang);
      await fs.writeFile(cachePath, translated, "utf-8");
      
      console.log(`💾 Legenda traduzida salva em cache: ${cacheKey}.srt`);
    } else {
      console.log(`✅ Cache encontrado: ${cacheKey}.srt`);
    }
    
    const protocol = req.headers["x-forwarded-proto"] === "https" || process.env.NODE_ENV === "production" ? "https" : req.protocol;
    
    const body = [
      {
        id: `${imdbId}:${targetLang}`,
        url: `${protocol}://${req.get("host")}/subtitles/file/${cacheKey}.srt`,
        lang: targetLang,
        name: `Auto-Translated (${targetLang.toUpperCase()})`,
      },
    ];
    
    res.json({ subtitles: body });
    
  } catch (err) {
    console.error(`❌ Erro ao processar legenda: ${err.message}`);
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
    res.setHeader("Content-Disposition", `inline; filename="${req.params.file}"`);
    fs.createReadStream(file).pipe(res);
  } else {
    res.status(404).send("Arquivo de legenda não encontrado");
  }
});

// =======================
// Health Check
// =======================

app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// =======================
// Página Inicial
// =======================

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Auto Translate RDG</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 20px;
        }
        .container {
          background: white;
          padding: 50px;
          border-radius: 16px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          text-align: center;
          max-width: 600px;
        }
        h1 { 
          color: #333; 
          font-size: 32px;
          margin-bottom: 15px; 
        }
        p { 
          color: #666; 
          font-size: 16px;
          margin-bottom: 30px;
          line-height: 1.6;
        }
        .btn {
          display: inline-block;
          background: #667eea;
          color: white;
          padding: 15px 35px;
          border-radius: 8px;
          text-decoration: none;
          font-weight: 600;
          font-size: 16px;
          transition: all 0.3s;
        }
        .btn:hover {
          background: #5568d3;
          transform: translateY(-2px);
          box-shadow: 0 10px 25px rgba(102, 126, 234, 0.4);
        }
        .feature {
          background: #f8f9fa;
          padding: 15px;
          border-radius: 8px;
          margin: 20px 0;
          text-align: left;
        }
        .feature h3 {
          color: #667eea;
          font-size: 14px;
          margin-bottom: 8px;
        }
        .feature p {
          font-size: 13px;
          margin: 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🎬 Auto Translate RDG</h1>
        <p>Addon <strong>GRATUITO</strong> para tradução automática de legendas no Stremio</p>
        
        <div class="feature">
          <h3>✅ Como funciona</h3>
          <p>Configure uma vez com sua API key do OpenSubtitles (gratuita) e traduza legendas automaticamente para seu idioma preferido</p>
        </div>
        
        <div class="feature">
          <h3>🌍 Suporta 15+ idiomas</h3>
          <p>Português, Inglês, Espanhol, Francês, Alemão, Italiano, Japonês, Coreano, Chinês, Russo e mais!</p>
        </div>
        
        <a href="/config" class="btn">⚙️ Configurar e Instalar</a>
      </div>
    </body>
    </html>
  `);
});

// =======================
// Inicializa Servidor
// =======================

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor iniciado na porta ${PORT}`);
  console.log(`📝 Configuração: http://localhost:${PORT}/config`);
  console.log(`💚 Health Check: http://localhost:${PORT}/health`);
});
