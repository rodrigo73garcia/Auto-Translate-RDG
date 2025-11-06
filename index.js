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

// 🔧 Middleware CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, User-Agent");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

app.use(express.json());

// 📁 Configuração de diretórios
const CACHE_DIR = path.join(__dirname, "cache");
const SUBTITLES_DIR = path.join(__dirname, "subtitles");

// Garante que os diretórios existam
[ CACHE_DIR, SUBTITLES_DIR ].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ⚡ Função para tradução com limite de concorrência
async function traduzirComLimite(tasks, limite = 3) {
  const resultados = [];
  const executando = [];
  
  for (const task of tasks) {
    const p = task().then(result => {
      executando.splice(executando.indexOf(p), 1);
      return result;
    });
    
    executando.push(p);
    resultados.push(p);
    
    if (executando.length >= limite) {
      await Promise.race(executando);
    }
  }
  
  return Promise.all(resultados);
}

// 🧠 Função para traduzir legenda com limite de 4800 caracteres
async function traduzirLegenda(conteudoOriginal, cacheFile) {
  const linhas = conteudoOriginal.split("\n");
  const blocos = [];
  const estrutura = [];

  let blocoAtual = [];
  let charsNoBloco = 0;
  const LIMITE_CHARS = 4800;

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    
    // Linhas de controle (números, timestamps, vazias)
    if (!linha.trim() || /^\d+$/.test(linha) || linha.includes("-->")) {
      if (blocoAtual.length > 0) {
        blocos.push(blocoAtual.join("\n"));
        estrutura.push({ tipo: "bloco", indexBloco: blocos.length - 1 });
        blocoAtual = [];
        charsNoBloco = 0;
      }
      estrutura.push({ tipo: "controle", valor: linha });
    } 
    // Linhas de texto
    else {
      const charsLinha = linha.length;
      
      if (charsNoBloco + charsLinha > LIMITE_CHARS && blocoAtual.length > 0) {
        blocos.push(blocoAtual.join("\n"));
        estrutura.push({ tipo: "bloco", indexBloco: blocos.length - 1 });
        blocoAtual = [linha];
        charsNoBloco = charsLinha;
      } else {
        blocoAtual.push(linha);
        charsNoBloco += charsLinha;
      }
    }
  }

  if (blocoAtual.length > 0) {
    blocos.push(blocoAtual.join("\n"));
    estrutura.push({ tipo: "bloco", indexBloco: blocos.length - 1 });
  }

  console.log(`🔧 Processando ${blocos.length} blocos de tradução...`);

  // 🚀 Traduz blocos em paralelo
  const tarefasTraducao = blocos.map((bloco, index) => 
    () => translate(bloco, { from: "en", to: "pt" })
      .then(traducao => ({ index, texto: traducao.text }))
      .catch(e => {
        console.error(`❌ Erro no bloco ${index}:`, e.message);
        return { index, texto: bloco };
      })
  );

  const resultados = await traduzirComLimite(tarefasTraducao, 3);

  // 🧩 Reconstrói o conteúdo
  const traducoesMap = new Map();
  resultados.forEach(result => {
    traducoesMap.set(result.index, result.texto);
  });

  const linhasTraduzidas = [];
  for (const item of estrutura) {
    if (item.tipo === "controle") {
      linhasTraduzidas.push(item.valor);
    } else {
      const textoTraduzido = traducoesMap.get(item.indexBloco);
      textoTraduzido.split('\n').forEach(linha => {
        if (linha.trim()) linhasTraduzidas.push(linha);
      });
    }
  }

  const conteudoFinal = linhasTraduzidas.join("\n");
  fs.writeFileSync(cacheFile, conteudoFinal, "utf8");
  
  console.log(`✅ Tradução concluída: ${blocos.length} blocos`);
  return conteudoFinal;
}

// 🎯 Função para buscar legenda no OpenSubtitles (CORRIGIDA)
async function buscarLegendaOpenSubtitles(imdbId, tipo, season, episode) {
  try {
    const cleanId = imdbId.replace("tt", "");
    let url;

    // 🔧 CORREÇÃO: Usa a estrutura correta da API do OpenSubtitles
    if (tipo === "series" && season && episode) {
      url = `https://rest.opensubtitles.org/search/imdbid-${cleanId}/season-${season}/episode-${episode}/sublanguageid-eng`;
      console.log(`📺 Buscando série: IMDB:${cleanId} S${season}E${episode}`);
    } else {
      url = `https://rest.opensubtitles.org/search/imdbid-${cleanId}/sublanguageid-eng`;
      console.log(`🎬 Buscando filme: IMDB:${cleanId}`);
    }

    console.log(`🔍 URL: ${url}`);

    const resp = await fetch(url, {
      headers: { 
        "User-Agent": "Stremio-AutoTranslate-Addon/1.2.0",
        "Accept": "application/json"
      },
    });
    
    if (!resp.ok) {
      throw new Error(`Erro OpenSubtitles: ${resp.status}`);
    }

    const data = await resp.json();
    
    if (!data || !Array.isArray(data) || data.length === 0) {
      throw new Error("Nenhuma legenda encontrada");
    }

    // 🔧 CORREÇÃO: Usa a estrutura correta dos dados do OpenSubtitles
    const legenda = data[0];
    
    // Tenta diferentes campos possíveis para o link de download
    const downloadUrl = legenda.SubDownloadLink || legenda.url || legenda.subtitle_url;
    
    if (!downloadUrl) {
      throw new Error("Legenda sem URL de download");
    }

    // Remove .gz se existir (como no seu script antigo)
    const finalUrl = downloadUrl.replace(".gz", "");
    console.log(`📥 Baixando legenda: ${finalUrl}`);

    const legendaResp = await fetch(finalUrl);
    if (!legendaResp.ok) {
      throw new Error(`Erro ao baixar: ${legendaResp.status}`);
    }

    const conteudo = await legendaResp.text();
    return conteudo;

  } catch (e) {
    console.error("❌ Erro buscarLegendaOpenSubtitles:", e.message);
    throw e;
  }
}

// 🧩 Função principal para obter legenda (com cache)
async function obterLegendaTraduzida(imdbId, tipo, season, episode) {
  const cacheFile = path.join(
    CACHE_DIR, 
    `${tipo}-${imdbId}-${season || "0"}-${episode || "0"}.srt`
  );

  // Verifica cache primeiro
  if (fs.existsSync(cacheFile)) {
    console.log("♻️ Usando cache:", path.basename(cacheFile));
    const conteudoCache = fs.readFileSync(cacheFile, "utf8");
    if (conteudoCache && conteudoCache.length > 100) {
      return conteudoCache;
    }
  }

  // Busca e traduz
  console.log("🌐 Buscando legenda original...");
  const legendaOriginal = await buscarLegendaOpenSubtitles(imdbId, tipo, season, episode);
  
  console.log("🔄 Traduzindo para PT-BR...");
  const legendaTraduzida = await traduzirLegenda(legendaOriginal, cacheFile);
  
  return legendaTraduzida;
}

// 🛠️ Rota para filmes - Formato Stremio: /subtitles/movie/tt123456/filename
app.get("/subtitles/movie/:imdbId/:filename", async (req, res) => {
  try {
    const imdbId = req.params.imdbId;
    console.log(`🎬 Filme: ${imdbId}`);
    
    const legenda = await obterLegendaTraduzida(imdbId, "movie");
    
    res.header("Content-Type", "text/plain; charset=utf-8");
    res.send(legenda);
    
  } catch (e) {
    console.error("❌ Erro rota filme:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 🛠️ Rota para séries - Formato Stremio: /subtitles/series/tt123456:1:2/filename
app.get("/subtitles/series/:id/:filename", async (req, res) => {
  try {
    const partes = req.params.id.split(":");
    
    if (partes.length < 3) {
      throw new Error("Formato inválido. Use: tt123456:season:episode");
    }

    const imdbId = partes[0];
    const season = partes[1];
    const episode = partes[2];
    
    console.log(`📺 Série: ${imdbId} S${season}E${episode}`);
    
    const legenda = await obterLegendaTraduzida(imdbId, "series", season, episode);
    
    res.header("Content-Type", "text/plain; charset=utf-8");
    res.send(legenda);
    
  } catch (e) {
    console.error("❌ Erro rota série:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 🌍 Rota do manifest
app.get("/manifest.json", (req, res) => {
  res.header("Content-Type", "application/json");
  res.json({
    id: "org.rdga.auto-translate",
    version: "1.2.0",
    name: "Auto Translate Subtitles",
    description: "Traduz automaticamente legendas para PT-BR usando OpenSubtitles + Google Translate",
    types: ["movie", "series"],
    resources: [
      {
        name: "subtitles",
        types: ["movie", "series"],
        idPrefixes: ["tt"],
      },
    ],
    idPrefixes: ["tt"],
    catalogs: [],
    behaviorHints: { 
      configurable: false, 
      configurationRequired: false 
    },
  });
});

// 🏠 Rotas auxiliares
app.get("/", (req, res) => {
  res.json({ 
    status: "🚀 Auto Translate Subtitles API",
    version: "1.2.0",
    endpoints: {
      manifest: "/manifest.json",
      movie: "/subtitles/movie/tt123456/filename.srt",
      series: "/subtitles/series/tt123456:1:2/filename.srt"
    }
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 🚀 Inicialização
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📋 Manifest: http://0.0.0.0:${PORT}/manifest.json`);
});
