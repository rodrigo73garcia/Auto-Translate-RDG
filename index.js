import express from "express";
import axios from "axios"; // ⬅️ SUBSTITUÍDO: Usando Axios
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import translate from "google-translate-api-x"; 

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000; 

const MAX_ERROR_DELAY_MS = 15000; 
const MAX_ATTEMPTS = 5; 
const USER_AGENT = process.env.OPEN_SUBTITLES_USER_AGENT || "TemporaryUserAgent";

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
// Função para obter legenda original do OpenSubtitles - USANDO AXIOS
// =======================
async function getSubtitle(imdbId, season, episode) {
  const cleanId = imdbId.replace(/tt/i, "").split(":")[0];

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
    // 🔧 AXIOS: Usando axios.get para a busca inicial
    const response = await axios.get(url, {
      headers: { "User-Agent": USER_AGENT },
    });
    
    const data = response.data; // Axios retorna o objeto de dados diretamente

    if (!Array.isArray(data) || data.length === 0)
      throw new Error("Nenhuma legenda encontrada no OpenSubtitles.");

    const subUrl = data[0].SubDownloadLink; 

    if (!subUrl) throw new Error("Link de download da legenda não encontrado.");

    console.log(`[${new Date().toISOString()}] Link da legenda encontrado: ${subUrl}`);

    // 🔧 AXIOS: Usando axios.get para o download do ficheiro (com responseType: 'arraybuffer')
    const subRes = await axios.get(subUrl, { responseType: 'arraybuffer' });

    // Axios lida com erros HTTP como exceções, então response.ok não é necessário
    
    // O Axios automaticamente descompacta o GZIP se o servidor enviar o header correto
    return Buffer.from(subRes.data).toString("utf-8");
  } catch (err) {
    // Axios usa err.message para erros de rede, ou err.response.status para erros HTTP
    console.error("❌ Erro ao buscar legenda:", err.message || err.response?.statusText);
    throw err;
  }
}

// =======================
// Traduz legenda (Mantido o tratamento de Rate Limit)
// =======================
async function translateSubtitle(content, targetLang = "pt") {
  const lines = content.split("\n");
  const blocks = [];
  let temp = "";

  // Lógica de agrupamento de blocos
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

  const translated = [];

  for (let i = 0; i < blocks.length; i++) {
    let attempt = 0;
    
    while (attempt < MAX_ATTEMPTS) {
      try {
        console.log(`🌐 Traduzindo bloco ${i + 1}/${blocks.length} (Tentativa ${attempt + 1})...`);
        
        const res = await translate(blocks[i], { to: targetLang });
        translated.push(res.text);
        console.log(`✅ Bloco ${i + 1}/${blocks.length} traduzido com sucesso.`);
        
        // DELAY de sucesso: 1 a 3 segundos entre blocos
        if (i < blocks.length - 1) {
          const successDelay = 1000 + Math.random() * 2000; 
          console.log(`⏳ Aguardando ${Math.round(successDelay)}ms antes do próximo bloco...`);
          await new Promise(resolve => setTimeout(resolve, successDelay));
        }
        break; // Sai do loop 'while' se for bem-sucedido
      } catch (err) {
        attempt++;
        console.error(`❌ Erro no bloco ${i + 1} (Tentativa ${attempt}):`, err.message);
        
        if (attempt >= MAX_ATTEMPTS) {
          console.error("🛑 Máximo de tentativas alcançado. Pulando bloco.");
          translated.push(blocks[i]); 
          break;
        }
        
        // Delay em caso de erro: 5 a 15 segundos
        const errorDelay = 5000 + Math.random() * (MAX_ERROR_DELAY_MS - 5000); 
        console.log(`🚫 Erro detectado, aguardando ${Math.round(errorDelay)}ms para tentar novamente...`);
        await new Promise(resolve => setTimeout(resolve, errorDelay));
      }
    }
  }

  return translated.join("\n");
}

// =======================
// Rotas (Nenhuma alteração)
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
    res.json({ subtitles: [] }); 
  }
});

app.get("/subtitles/series/:id/:filename", async (req, res) => {
  try {
    const decodedId = decodeURIComponent(req.params.id);
    const partes = decodedId.split(":");
    
    if (partes.length < 3) {
      return res.status(400).json({ error: "Formato inválido. Use: tt123456:season:episode" });
    }

    const [imdbId, season, episode] = partes; 
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
    res.json({ subtitles: [] }); 
  }
});

app.get("/subtitles/file/:file", async (req, res) => {
  const file = path.join(subtitlesDir, req.params.file);

  if (fs.existsSync(file)) {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(fs.readFileSync(file, "utf8"));
  } else {
    res.status(404).send("Arquivo não encontrado");
  }
});

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
