import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { PORT } from "./config.js";
import { fetchAndTranslateSubtitle } from "./subtitles.js";
import { generateManifest } from "./manifest.js";

const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

// Health check
app.get("/health", (req, res) => {
  console.log("✅ Health check recebido");
  res.status(200).json({ status: "ok", message: "Auto Translate RDG is running!" });
});

// Página inicial
app.get("/", (req, res) => {
  try {
    res.sendFile(process.cwd() + "/public/index.html");
  } catch (err) {
    console.error("❌ Erro ao servir index.html:", err.message);
    res.json({ message: "Auto Translate RDG - Stremio Addon" });
  }
});

// Rota do manifest
app.get("/manifest.json", (req, res) => {
  try {
    const lang = req.query.lang || "pt-br";
    console.log(`📋 Manifest solicitado: ${lang}`);
    const manifest = generateManifest(lang);
    res.json(manifest);
  } catch (err) {
    console.error("❌ Erro ao gerar manifest:", err.message);
    res.status(500).json({ error: "Erro ao gerar manifest" });
  }
});

// Rota de catálogo (vazio, mas necessário para Stremio reconhecer)
app.get("/catalog/movie/default.json", (req, res) => {
  console.log("📚 Catálogo solicitado");
  res.json({ metas: [] });
});

app.get("/catalog/series/default.json", (req, res) => {
  console.log("📚 Catálogo de séries solicitado");
  res.json({ metas: [] });
});

// Helper para remover prefixo "tt"
function cleanImdbId(id) {
  return id.replace(/^tt/, "");
}

// Rota para legendas de filmes
app.get("/subtitles/movie/:imdbId.json", async (req, res) => {
  try {
    const imdbId = cleanImdbId(req.params.imdbId);
    const lang = req.query.lang || "pt-br";
    console.log(`🎬 Solicitação: movie/${imdbId} - Idioma: ${lang}`);
    
    const result = await fetchAndTranslateSubtitle(imdbId, lang);
    res.json(result || { subtitles: [] });
  } catch (err) {
    console.error("❌ Erro na rota /subtitles/movie:", err.message);
    res.json({ subtitles: [] });
  }
});

// Rota para legendas de séries
app.get("/subtitles/series/:imdbId.json", async (req, res) => {
  try {
    const imdbId = cleanImdbId(req.params.imdbId);
    const lang = req.query.lang || "pt-br";
    console.log(`📺 Solicitação: series/${imdbId} - Idioma: ${lang}`);
    
    const result = await fetchAndTranslateSubtitle(imdbId, lang);
    res.json(result || { subtitles: [] });
  } catch (err) {
    console.error("❌ Erro na rota /subtitles/series:", err.message);
    res.json({ subtitles: [] });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error("❌ Erro global:", err.message);
  res.status(500).json({ error: "Erro no servidor" });
});

const server = app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;
