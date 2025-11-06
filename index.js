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
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ⚡ Sistema de tradução COM PROTECÇÃO CONTRA RATE LIMITING
class TradutorOtimizado {
  constructor() {
    this.limiteRequisicoes = 2; // REDUZIDO para evitar rate limiting
    this.intervaloRequisicoes = 1000; // 1 segundo entre batches
    this.tempoEntreBlocos = 500; // 0.5 seg entre blocos
  }

  // 🧠 Agrupa linhas em blocos inteligentes (diálogos completos)
  agruparLinhasInteligentes(linhas) {
    const blocos = [];
    let blocoAtual = [];
    let charsNoBloco = 0;
    const LIMITE_CHARS = 4500; // Reduzido para margem extra

    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i];
      
      // Linhas de controle - sempre separadas
      if (!linha.trim() || /^\d+$/.test(linha) || linha.includes("-->")) {
        if (blocoAtual.length > 0) {
          blocos.push(blocoAtual.join("\n"));
          blocoAtual = [];
          charsNoBloco = 0;
        }
        blocos.push(linha); // Linhas de controle como blocos individuais
        continue;
      }
      
      // Linhas de texto - agrupa inteligentemente
      const charsLinha = linha.length;
      
      // Se ultrapassar limite ou for um diálogo muito longo, finaliza bloco
      if ((charsNoBloco + charsLinha > LIMITE_CHARS) || blocoAtual.length >= 8) {
        if (blocoAtual.length > 0) {
          blocos.push(blocoAtual.join("\n"));
          blocoAtual = [];
          charsNoBloco = 0;
        }
      }
      
      blocoAtual.push(linha);
      charsNoBloco += charsLinha;
    }

    if (blocoAtual.length > 0) {
      blocos.push(blocoAtual.join("\n"));
    }

    console.log(`🔧 Agrupadas ${linhas.length} linhas em ${blocos.length} blocos`);
    return blocos;
  }

  // 🚀 Traduz com delays inteligentes para evitar rate limiting
  async traduzirBlocosComDelay(blocos) {
    const resultados = [];
    
    for (let i = 0; i < blocos.length; i++) {
      const bloco = blocos[i];
      
      try {
        console.log(`🌐 Traduzindo bloco ${i + 1}/${blocos.length} (${bloco.length} chars)...`);
        
        const traducao = await translate(bloco, { 
          from: "en", 
          to: "pt",
          // Opções para reduzir detecção de bot
          requestFunction: (url, options) => {
            return fetch(url, {
              ...options,
              headers: {
                ...options.headers,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
              }
            });
          }
        });
        
        resultados.push(traducao.text);
        console.log(`✅ Bloco ${i + 1} traduzido com sucesso`);
        
        // ⏰ DELAY ENTRE BLOCOS - CRÍTICO para evitar rate limiting
        if (i < blocos.length - 1) {
          const delay = this.tempoEntreBlocos + (Math.random() * 500); // Delay aleatório
          console.log(`⏳ Aguardando ${delay.toFixed(0)}ms antes do próximo bloco...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
      } catch (error) {
        console.error(`❌ Erro no bloco ${i + 1}:`, error.message);
        resultados.push(bloco); // Fallback para texto original
        
        // ⚠️ Se for rate limit, espera mais tempo
        if (error.message.includes('Too Many Requests') || error.message.includes('429')) {
          console.log('🚫 Rate limit detectado, aguardando 5 segundos...');
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }
    
    return resultados;
  }

  async traduzirConteudo(conteudoOriginal) {
    const linhas = conteudoOriginal.split("\n");
    const blocos = this.agruparLinhasInteligentes(linhas);
    
    console.log(`🚀 Iniciando tradução de ${blocos.length} blocos...`);
    
    const blocosTraduzidos = await this.traduzirBlocosComDelay(blocos);
    
    // Reconstroi o conteúdo mantendo a estrutura original
    let linhaIndex = 0;
    const resultadoFinal = [];
    
    for (const bloco of blocos) {
      if (!bloco.trim() || /^\d+$/.test(bloco) || bloco.includes("-->")) {
        // Linha de controle - mantém original
        resultadoFinal.push(bloco);
      } else {
        // Bloco traduzido - divide em linhas
        const blocoTraduzido = blocosTraduzidos.shift();
        if (blocoTraduzido) {
          blocoTraduzido.split('\n').forEach(linha => {
            if (linha.trim()) resultadoFinal.push(linha);
          });
        }
      }
    }
    
    console.log(`🎉 Tradução concluída: ${resultadoFinal.length} linhas`);
    return resultadoFinal.join("\n");
  }
}

const tradutor = new TradutorOtimizado();

// 🎯 Função para buscar legenda no OpenSubtitles
async function buscarLegendaOpenSubtitles(imdbId, tipo, season, episode) {
  try {
    const cleanId = imdbId.replace("tt", "");
    let url;

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

    const legenda = data[0];
    const downloadUrl = legenda.SubDownloadLink || legenda.url;
    
    if (!downloadUrl) {
      throw new Error("Legenda sem URL de download");
    }

    const finalUrl = downloadUrl.replace(".gz", "");
    console.log(`📥 Baixando legenda: ${finalUrl}`);

    const legendaResp = await fetch(finalUrl);
    if (!legendaResp.ok) {
      throw new Error(`Erro ao baixar: ${legendaResp.status}`);
    }

    return await legendaResp.text();

  } catch (e) {
    console.error("❌ Erro ao buscar legenda:", e.message);
    throw e;
  }
}

// 🧩 Função principal com cache
async function obterLegendaTraduzida(imdbId, tipo, season, episode) {
  const cacheFile = path.join(
    CACHE_DIR, 
    `${tipo}-${imdbId}-${season || "0"}-${episode || "0"}.srt`
  );

  // Verifica cache primeiro
  if (fs.existsSync(cacheFile)) {
    console.log("♻️ Usando cache:", path.basename(cacheFile));
    return fs.readFileSync(cacheFile, "utf8");
  }

  try {
    console.log("🌐 Buscando legenda original...");
    const legendaOriginal = await buscarLegendaOpenSubtitles(imdbId, tipo, season, episode);
    
    console.log("🔄 Iniciando tradução (sistema otimizado)...");
    const legendaTraduzida = await tradutor.traduzirConteudo(legendaOriginal);
    
    // Salva no cache
    fs.writeFileSync(cacheFile, legendaTraduzida, "utf8");
    console.log("💾 Legenda salva no cache");
    
    return legendaTraduzida;
    
  } catch (error) {
    console.error("❌ Erro ao processar legenda:", error.message);
    throw error;
  }
}

// 🛠️ Rotas do Stremio
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
    status: "🚀 Auto Translate Subtitles API - Sistema Otimizado",
    version: "1.2.0"
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 🚀 Inicialização
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📋 Manifest: http://0.0.0.0:${PORT}/manifest.json`);
  console.log(`⚠️  Sistema otimizado com proteção contra rate limiting`);
});
