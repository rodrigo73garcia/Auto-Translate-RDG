import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import translate from "google-translate-api-x";

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

const app = express();
const PORT = process.env.PORT || 10000;

// 🔧 Variáveis de ambiente com valores padrão
const OPENSUBTITLES_API =
  process.env.OPENSUBTITLES_API || "https://rest.opensubtitles.org";

const CACHE_DIR = path.resolve("cache");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

// 🧠 Função para traduzir legenda linha a linha com cache interno
async function traduzirLegenda(conteudoOriginal, cacheFile) {
  const linhas = conteudoOriginal.split("\n");
  const resultado = [];

  for (const linha of linhas) {
    if (!linha.trim() || /^\d+$/.test(linha) || linha.includes("-->")) {
      resultado.push(linha);
      continue;
    }

    try {
      const traducao = await translate(linha, { from: "en", to: "pt" });
      resultado.push(traducao.text);
    } catch (e) {
      console.error("❌ Erro ao traduzir linha:", e.message);
      resultado.push(linha);
    }
  }

  const traduzido = resultado.join("\n");
  fs.writeFileSync(cacheFile, traduzido);
  return traduzido;
}

// 🧩 Busca e traduz legendas (filmes e séries)
async function buscarLegenda(imdbId, tipo, season, episode) {
  try {
    let url;

    if (tipo === "series") {
      url = `${OPENSUBTITLES_API}/search/imdbid-${imdbId}/season-${season}/episode-${episode}/sublanguageid-eng`;
    } else {
      url = `${OPENSUBTITLES_API}/search/imdbid-${imdbId}/sublanguageid-eng`;
    }

    console.log("Buscando legendas originais:", url);

    const resp = await fetch(url, {
      headers: { "User-Agent": "TemporaryUserAgent" },
    });
    if (!resp.ok) throw new Error(`Erro ao buscar legendas: ${resp.status}`);

    const legendas = await resp.json();
    const primeira = legendas[0];
    if (!primeira?.url) throw new Error("Nenhuma legenda encontrada.");

    console.log("🎯 Legenda encontrada:", primeira.url);

    const legendaOrig = await fetch(primeira.url);
    const conteudoOriginal = await legendaOrig.text();

    // 🔍 Define nome do arquivo de cache
    const cacheFile = path.join(
      CACHE_DIR,
      `${tipo}-${imdbId}-${season || ""}-${episode || ""}.srt`
    );

    if (fs.existsSync(cacheFile)) {
      console.log("♻️ Servindo do cache:", cacheFile);
      return fs.readFileSync(cacheFile, "utf8");
    }

    console.log("🌐 Traduzindo legenda para PT-BR...");
    return await traduzirLegenda(conteudoOriginal, cacheFile);
  } catch (e) {
    console.error("❌ Erro geral:", e.message);
    throw e;
  }
}

// 🛠️ Rota para filmes
app.get("/subtitles/movie/:imdbId/:filename", async (req, res) => {
  const imdbId = req.params.imdbId.replace("tt", "");
  try {
    const legenda = await buscarLegenda(imdbId, "movie");
    res.type("text/plain").send(legenda);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 🛠️ Rota para séries
app.get("/subtitles/series/:id/:filename", async (req, res) => {
  const [imdbId, season, episode] = req.params.id.split(":");
  try {
    const legenda = await buscarLegenda(imdbId.replace("tt", ""), "series", season, episode);
    res.type("text/plain").send(legenda);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 🌍 Manifest.json (rota principal)
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "org.rdga.auto-translate",
    version: "1.1.0",
    name: "Auto Translate Subtitles",
    description:
      "Traduz automaticamente legendas para PT-BR usando OpenSubtitles + Google Translate API-X.",
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
    behaviorHints: { configurable: false, configurationRequired: false },
  });
});

app.get("/", (req, res) => res.send("🚀 Servidor ativo!"));

app.listen(PORT, () => console.log(`🚀 Servidor iniciado na porta ${PORT}`));
