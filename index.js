import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import translate from "google-translate-api-x";

const app = express();
const PORT = process.env.PORT || 10000;

// 🔧 Middleware CORS ESSENCIAL para Stremio
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, User-Agent");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  
  // Responde imediatamente para requisições OPTIONS (preflight)
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🔧 Variáveis de ambiente com valores padrão
const OPENSUBTITLES_API = process.env.OPENSUBTITLES_API || "https://rest.opensubtitles.org";

const CACHE_DIR = path.resolve("cache");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ⚡ Função auxiliar para limite de concorrência nas traduções
async function traduzirComLimite(tasks, limite = 3) {
  const resultados = [];
  const executing = [];
  
  for (const task of tasks) {
    const p = task().then(result => {
      executing.splice(executing.indexOf(p), 1);
      return result;
    });
    
    executing.push(p);
    resultados.push(p);
    
    if (executing.length >= limite) {
      await Promise.race(executing);
    }
  }
  
  return Promise.all(resultados);
}

// 🧠 Função para traduzir legenda com limite de 4800 caracteres por bloco
async function traduzirLegenda(conteudoOriginal, cacheFile) {
  const linhas = conteudoOriginal.split("\n");
  const blocos = [];
  const estrutura = [];

  // 🧩 Agrupa linhas em blocos de ATÉ 4800 caracteres
  let blocoAtual = [];
  let charsNoBloco = 0;
  const LIMITE_CHARS = 4800; // Margem de segurança

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    
    // Linhas de controle (timestamp, números, vazias)
    if (!linha.trim() || /^\d+$/.test(linha) || linha.includes("-->")) {
      // Finaliza bloco atual se existir
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
      
      // Se adicionar esta linha ultrapassar o limite, finaliza bloco atual
      if (charsNoBloco + charsLinha > LIMITE_CHARS && blocoAtual.length > 0) {
        blocos.push(blocoAtual.join("\n"));
        estrutura.push({ tipo: "bloco", indexBloco: blocos.length - 1 });
        blocoAtual = [linha];
        charsNoBloco = charsLinha;
      } 
      // Caso contrário, adiciona ao bloco atual
      else {
        blocoAtual.push(linha);
        charsNoBloco += charsLinha;
      }
    }
  }

  // Finaliza último bloco se existir
  if (blocoAtual.length > 0) {
    blocos.push(blocoAtual.join("\n"));
    estrutura.push({ tipo: "bloco", indexBloco: blocos.length - 1 });
  }

  console.log(`🔧 Processando ${blocos.length} blocos (limite: ${LIMITE_CHARS} chars)...`);
  
  // Log de tamanhos dos blocos para debug
  blocos.forEach((bloco, i) => {
    console.log(`  Bloco ${i + 1}: ${bloco.length} caracteres, ${bloco.split('\n').length} linhas`);
  });

  // 🚀 Traduz blocos com limite de concorrência
  const tarefasTraducao = blocos.map((bloco, index) => 
    () => {
      console.log(`🌐 Traduzindo bloco ${index + 1} (${bloco.length} chars)...`);
      return translate(bloco, { from: "en", to: "pt" })
        .then(traducao => ({ index, texto: traducao.text }))
        .catch(e => {
          console.error(`❌ Erro no bloco ${index}:`, e.message);
          return { index, texto: bloco }; // Fallback para texto original
        });
    }
  );

  const resultados = await traduzirComLimite(tarefasTraducao, 3); // 3 traduções simultâneas

  // 🧩 Organiza resultados por índice
  const traducoesMap = new Map();
  resultados.forEach(result => {
    traducoesMap.set(result.index, result.texto);
  });

  // 📝 Reconstrói o arquivo .srt
  const linhasTraduzidas = [];
  for (const item of estrutura) {
    if (item.tipo === "controle") {
      linhasTraduzidas.push(item.valor);
    } else {
      const textoTraduzido = traducoesMap.get(item.indexBloco);
      // Divide o texto traduzido preservando as linhas originais
      const linhasDoBloco = textoTraduzido.split('\n');
      linhasDoBloco.forEach(linha => {
        if (linha.trim()) linhasTraduzidas.push(linha);
      });
    }
  }

  const conteudoFinal = linhasTraduzidas.join("\n");
  fs.writeFileSync(cacheFile, conteudoFinal, "utf8");
  
  console.log(`✅ Tradução concluída: ${blocos.length} blocos, ${conteudoFinal.length} chars totais`);
  return conteudoFinal;
}

// 🧩 Busca e traduz legendas (filmes e séries)
async function buscarLegenda(imdbId, tipo, season, episode) {
  try {
    let url;
    let params = "";

    // 🎯 Constrói a URL correta para OpenSubtitles
    if (tipo === "series") {
      // Para séries: /search/imdbid-{id}/season-{s}/episode-{e}/sublanguageid-eng
      params = `imdbid-${imdbId}/season-${season}/episode-${episode}/sublanguageid-eng`;
      console.log(`📺 Buscando legenda para série: IMDB:${imdbId} S${season}E${episode}`);
    } else {
      // Para filmes: /search/imdbid-{id}/sublanguageid-eng
      params = `imdbid-${imdbId}/sublanguageid-eng`;
      console.log(`🎬 Buscando legenda para filme: IMDB:${imdbId}`);
    }

    url = `${OPENSUBTITLES_API}/search/${params}`;
    console.log("🔍 URL OpenSubtitles:", url);

    const resp = await fetch(url, {
      headers: { 
        "User-Agent": "Stremio-AutoTranslate-Addon/1.1.0",
        "Accept": "application/json"
      },
    });
    
    if (!resp.ok) {
      throw new Error(`Erro OpenSubtitles: ${resp.status} - ${resp.statusText}`);
    }

    const legendas = await resp.json();
    
    if (!legendas || !Array.isArray(legendas) || legendas.length === 0) {
      throw new Error("Nenhuma legenda encontrada no OpenSubtitles");
    }

    // Ordena por melhor qualidade/score
    const legenda = legendas.sort((a, b) => {
      const scoreA = a.score || 0;
      const scoreB = b.score || 0;
      return scoreB - scoreA;
    })[0];

    if (!legenda?.url) {
      throw new Error("Legenda encontrada mas sem URL de download");
    }

    console.log("🎯 Melhor legenda encontrada:", legenda.url);
    console.log("📊 Detalhes:", {
      arquivo: legenda.filename,
      score: legenda.score,
      downloads: legenda.downloads
    });

    // Baixa a legenda original
    const legendaOrig = await fetch(legenda.url);
    if (!legendaOrig.ok) {
      throw new Error(`Erro ao baixar legenda: ${legendaOrig.status}`);
    }
    
    const conteudoOriginal = await legendaOrig.text();

    // 🔍 Define nome do arquivo de cache
    const cacheFile = path.join(
      CACHE_DIR,
      `${tipo}-${imdbId}-${season || "0"}-${episode || "0"}.srt`
    );

    // Verifica cache
    if (fs.existsSync(cacheFile)) {
      console.log("♻️ Servindo do cache:", cacheFile);
      const conteudoCache = fs.readFileSync(cacheFile, "utf8");
      
      // Verifica se o cache não está vazio/corrompido
      if (conteudoCache && conteudoCache.length > 100) {
        return conteudoCache;
      } else {
        console.log("⚠️ Cache vazio/corrompido, retraduzindo...");
      }
    }

    console.log("🌐 Iniciando tradução para PT-BR...");
    return await traduzirLegenda(conteudoOriginal, cacheFile);

  } catch (e) {
    console.error("❌ Erro em buscarLegenda:", e.message);
    throw e;
  }
}

// 🛠️ Rota para filmes - Stremio: /subtitles/movie/tt123456/filename.srt
app.get("/subtitles/movie/:imdbId/:filename", async (req, res) => {
  try {
    const imdbId = req.params.imdbId.replace("tt", "");
    console.log(`🎬 Rota FILME: tt${imdbId} - ${req.params.filename}`);
    
    const legenda = await buscarLegenda(imdbId, "movie");
    
    res.header("Content-Type", "text/plain; charset=utf-8");
    res.header("Access-Control-Allow-Origin", "*");
    res.send(legenda);
    
  } catch (e) {
    console.error("❌ Erro na rota de filmes:", e.message);
    res.header("Access-Control-Allow-Origin", "*");
    res.status(500).json({ 
      error: `Erro ao buscar legenda: ${e.message}` 
    });
  }
});

// 🛠️ Rota para séries - Stremio: /subtitles/series/tt123456:1:2/filename.srt
app.get("/subtitles/series/:id/:filename", async (req, res) => {
  try {
    // O Stremio envia: tt123456:1:2 (IMDB:Season:Episode)
    const partes = req.params.id.split(":");
    
    if (partes.length < 3) {
      throw new Error("Formato inválido para série. Esperado: tt123456:season:episode");
    }

    const imdbId = partes[0].replace("tt", "");
    const season = partes[1];
    const episode = partes[2];
    
    console.log(`📺 Rota SÉRIE: tt${imdbId} S${season}E${episode} - ${req.params.filename}`);
    
    const legenda = await buscarLegenda(imdbId, "series", season, episode);
    
    res.header("Content-Type", "text/plain; charset=utf-8");
    res.header("Access-Control-Allow-Origin", "*");
    res.send(legenda);
    
  } catch (e) {
    console.error("❌ Erro na rota de séries:", e.message);
    res.header("Access-Control-Allow-Origin", "*");
    res.status(500).json({ 
      error: `Erro ao buscar legenda: ${e.message}` 
    });
  }
});

// 🌍 Manifest.json (rota principal) - COM CORS EXPLÍCITO
app.get("/manifest.json", (req, res) => {
  res.header("Content-Type", "application/json");
  res.header("Access-Control-Allow-Origin", "*");
  res.json({
    id: "org.rdga.auto-translate",
    version: "1.1.0",
    name: "Auto Translate Subtitles",
    description: "Traduz automaticamente legendas para PT-BR usando OpenSubtitles + Google Translate API-X.",
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

// 🏠 Rota raiz para health check
app.get("/", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.json({ 
    status: "🚀 Servidor de Legendas Auto Translate ativo!",
    version: "1.1.0",
    endpoints: {
      manifest: "/manifest.json",
      movie_subtitles: "/subtitles/movie/:imdbId/:filename",
      series_subtitles: "/subtitles/series/:imdbId:season:episode/:filename"
    }
  });
});

// 🔧 Rota de health check para o Render.com
app.get("/health", (req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    service: "Auto Translate Subtitles API"
  });
});

// ❌ Handler de erros global
app.use((err, req, res, next) => {
  console.error("💥 Erro não tratado:", err);
  res.header("Access-Control-Allow-Origin", "*");
  res.status(500).json({ 
    error: "Erro interno do servidor",
    message: err.message 
  });
});

// 🔍 Handler para rotas não encontradas
app.use((req, res) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.status(404).json({ 
    error: "Rota não encontrada",
    path: req.path 
  });
});

// 🚀 Inicialização do servidor
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor iniciado na porta ${PORT}`);
  console.log(`📋 Manifest: http://0.0.0.0:${PORT}/manifest.json`);
  console.log(`🏠 Health check: http://0.0.0.0:${PORT}/health`);
  console.log(`💾 Cache dir: ${CACHE_DIR}`);
});
