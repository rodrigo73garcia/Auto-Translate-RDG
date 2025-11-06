import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import translate from "google-translate-api-x"; // Mantenho, mas recomendo cautela (ver notas)

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Render exige que o serviço escute na porta fornecida pela variável de ambiente PORT
const PORT = process.env.PORT || 10000; 

// Aumentamos o delay máximo para 15 segundos em caso de erro.
// Isso é uma tentativa de mitigar o erro "Too Many Requests".
const MAX_ERROR_DELAY_MS = 15000; 

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
// Função para obter legenda original do OpenSubtitles - CORREÇÕES IMPLEMENTADAS
// =======================
async function getSubtitle(imdbId, season, episode) {
  // Corrigido para remover 'tt' e garantir apenas o ID numérico.
  const cleanId = imdbId.replace(/tt/i, "").split(":")[0];
  
  // 🔧 CORREÇÃO 1: Definindo o User-Agent como variável de ambiente (boa prática)
  const USER_AGENT = process.env.OPEN_SUBTITLES_USER_AGENT || "TemporaryUserAgent";

  let url;
  if (season && episode) {
    // Corrigido para usar a URL de série
    url = `https://rest.opensubtitles.org/search/imdbid-${cleanId}/season-${season}/episode-${episode}/sublanguageid-eng`;
    console.log(`[${new Date().toISOString()}] Buscando série: IMDB:${cleanId} S${season}E${episode}`);
  } else {
    // URL para filme
    url = `https://rest.opensubtitles.org/search/imdbid-${cleanId}/sublanguageid-eng`;
    console.log(`[${new Date().toISOString()}] Buscando filme: IMDB:${cleanId}`);
  }
  
  console.log(`[${new Date().toISOString()}] Buscando legendas originais: ${url}`);

  try {
    const response = await fetch(url, {
      // O OpenSubtitles exige um User-Agent.
      headers: { "User-Agent": USER_AGENT },
    });
    
    // ⚠️ Atenção: A API do OpenSubtitles pode retornar 401 (Não Autorizado) ou 403 (Proibido) 
    // se o User-Agent não estiver registrado ou se estiver bloqueado.
    if (!response.ok) {
      throw new Error(`Erro HTTP ${response.status} na busca OpenSubtitles: ${response.statusText}`);
    }

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0)
      throw new Error("Nenhuma legenda encontrada no OpenSubtitles.");

    // O link de download geralmente vem com .gz e precisamos descompactar
    const subUrl = data[0].SubDownloadLink; 

    if (!subUrl) throw new Error("Link de download da legenda não encontrado.");

    console.log(`[${new Date().toISOString()}] Link da legenda encontrado: ${subUrl}`);

    const subRes = await fetch(subUrl);

    if (!subRes.ok)
      throw new Error(`Falha ao baixar legenda: ${subRes.statusText}`);

    // O OpenSubtitles geralmente retorna um arquivo GZIP. O 'node-fetch' descompacta 
    // automaticamente se o cabeçalho 'Content-Encoding: gzip' estiver presente.
    // Mantenho o processamento como buffer para garantir a decodificação UTF-8.
    const buffer = await subRes.arrayBuffer();
    return Buffer.from(buffer).toString("utf-8");
  } catch (err) {
    // Adicionei a verificação do erro para o caso do ENOTFOUND _
    if (err.code === 'ENOTFOUND') {
      console.error("❌ ERRO FATAL DE DNS/URL: Verifique a URL base da API OpenSubtitles.");
    }
    console.error("❌ Erro ao buscar legenda:", err.message);
    throw err;
  }
}

// =======================
// Traduz legenda COM PROTECÇÃO CONTRA RATE LIMITING (Aprimorada)
// =======================
async function translateSubtitle(content, targetLang = "pt") {
  const lines = content.split("\n");
  const blocks = [];
  let temp = "";

  // Lógica de agrupamento de blocos (mantida)
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

  // 🔧 CORREÇÃO 2: Aumentei o delay e tratei o loop
  for (let i = 0; i < blocks.length; i++) {
    let attempt = 0;
    const MAX_ATTEMPTS = 5;

    while (attempt < MAX_ATTEMPTS) {
      try {
        console.log(`🌐 Traduzindo bloco ${i + 1}/${blocks.length} (Tentativa ${attempt + 1})...`);
        
        const res = await translate(blocks[i], { to: targetLang });
        translated.push(res.text);
        console.log(`✅ Bloco ${i + 1}/${blocks.length} traduzido com sucesso.`);
        
        // ⏰ DELAY de sucesso: 1 a 3 segundos entre blocos
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
          translated.push(blocks[i]); // Mantém original se falhar após muitas tentativas
          break;
        }
        
        // ⏰ Delay em caso de erro: 5 a 15 segundos
        const errorDelay = 5000 + Math.random() * (MAX_ERROR_DELAY_MS - 5000); 
        console.log(`🚫 Erro detectado, aguardando ${Math.round(errorDelay)}ms para tentar novamente...`);
        await new Promise(resolve => setTimeout(resolve, errorDelay));
      }
    }
  }

  return translated.join("\n");
}

// =======================
// Manifest do addon (Nenhuma alteração necessária)
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
// Rota para filmes (Nenhuma alteração crítica, apenas limpeza)
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
    // Em caso de erro, retorna um array de legendas vazio (como o Stremio espera)
    res.json({ subtitles: [] });
  }
});

// =======================
// Rota para séries - CORREÇÃO DE ERRO PRINCIPAL
// =======================
app.get("/subtitles/series/:id/:filename", async (req, res) => {
  try {
    // 🔧 CORREÇÃO 3: O erro ENOTFOUND _ no log original provavelmente ocorreu
    // porque o 'imdbId' estava mal formatado ou a URL não foi construída corretamente.
    // O seu tratamento de decodificação é crucial aqui.
    const decodedId = decodeURIComponent(req.params.id);
    const partes = decodedId.split(":");
    
    if (partes.length < 3) {
      return res.status(400).json({ error: "Formato inválido. Use: tt123456:season:episode" });
    }

    // Garante que a ordem dos parâmetros está correta
    const [imdbId, season, episode] = partes; 
    const targetLang = "pt";
    
    const cleanId = imdbId.replace("tt", "");
    const cachePath = path.join(subtitlesDir, `series-${cleanId}-s${season}e${episode}_${targetLang}.srt`);

    console.log(`[${new Date().toISOString()}] 🔹 SÉRIE requisitada -> ${imdbId} S${season}E${episode}`);

    if (!fs.existsSync(cachePath)) {
      console.log("🕐 Nenhum cache encontrado. Buscando e traduzindo...");
      // Usa season e episode, ativando o bloco de séries em getSubtitle()
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
    // Em caso de erro, retorna um array de legendas vazio
    res.json({ subtitles: [] }); 
  }
});

// =======================
// Rota para servir arquivo SRT (Nenhuma alteração)
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
// Rotas auxiliares (Nenhuma alteração)
// =======================
app.get("/", (req, res) => {
  res.send("✅ Addon Auto-Translate RDG está rodando. Acesse /manifest.json");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// =======================
// Inicialização (Adiciona '0.0.0.0' para garantir compatibilidade com Render)
// =======================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor iniciado na porta ${PORT}`);
  console.log(`📋 Addon URL: https://auto-translate-rdg.onrender.com/manifest.json`);
});
