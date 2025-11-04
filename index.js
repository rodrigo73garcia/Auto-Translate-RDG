import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { PORT } from "./config.js";
import { fetchAndTranslateSubtitle } from "./subtitles.js";
import { generateManifest } from "./manifest.js";

const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.text());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// ============ HEALTH CHECK ============
app.get("/health", (req, res) => {
  console.log("✅ HEALTH CHECK");
  res.json({ status: "ok", message: "Auto Translate RDG running" });
});

// ============ MANIFEST ============
app.get("/manifest.json", (req, res) => {
  try {
    console.log("📋 MANIFEST REQUEST");
    const lang = req.query.lang || "pt-br";
    const manifest = generateManifest(lang);
    console.log("📋 MANIFEST RESPONSE:", JSON.stringify(manifest));
    res.json(manifest);
  } catch (err) {
    console.error("❌ MANIFEST ERROR:", err.message);
    res.status(500).json({ error: "Manifest error" });
  }
});

// ============ CATALOGS ============
app.get("/catalog/movie/default.json", (req, res) => {
  console.log("📚 CATALOG MOVIE REQUEST");
  res.json({ metas: [] });
});

app.get("/catalog/series/default.json", (req, res) => {
  console.log("📚 CATALOG SERIES REQUEST");
  res.json({ metas: [] });
});

// ============ SUBTITLES ============
function cleanImdbId(id) {
  return id.replace(/^tt/, "");
}

app.get("/subtitles/movie/:imdbId.json", async (req, res) => {
  try {
    const imdbId = cleanImdbId(req.params.imdbId);
    const lang = req.query.lang || "pt-BR";
    
    console.log(`🎬 SUBTITLE REQUEST MOVIE`);
    console.log(`   IMDb ID: ${imdbId}`);
    console.log(`   Language: ${lang}`);
    
    const result = await fetchAndTranslateSubtitle(imdbId, lang);
    
    console.log(`   Result: ${result ? "SUCCESS" : "NULL"}`);
    res.json(result || { subtitles: [] });
  } catch (err) {
    console.error("❌ SUBTITLE MOVIE ERROR:", err.message, err.stack);
    res.json({ subtitles: [] });
  }
});

app.get("/subtitles/series/:imdbId.json", async (req, res) => {
  try {
    const imdbId = cleanImdbId(req.params.imdbId);
    const lang = req.query.lang || "pt-BR";
    
    console.log(`📺 SUBTITLE REQUEST SERIES`);
    console.log(`   IMDb ID: ${imdbId}`);
    console.log(`   Language: ${lang}`);
    
    const result = await fetchAndTranslateSubtitle(imdbId, lang);
    
    console.log(`   Result: ${result ? "SUCCESS" : "NULL"}`);
    res.json(result || { subtitles: [] });
  } catch (err) {
    console.error("❌ SUBTITLE SERIES ERROR:", err.message, err.stack);
    res.json({ subtitles: [] });
  }
});

// ============ HOME ============
app.get("/", (req, res) => {
  res.json({ message: "Auto Translate RDG Stremio Addon" });
});

// ============ ERROR HANDLER ============
app.use((err, req, res, next) => {
  console.error("❌ GLOBAL ERROR:", err.message);
  res.status(500).json({ error: "Server error" });
});

// ============ START SERVER ============
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ SERVER RUNNING ON PORT ${PORT}`);
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;
