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

// ============ LOG TUDO ============
app.use((req, res, next) => {
  console.log(`\n>>> ${req.method} ${req.path} ${JSON.stringify(req.query)}`);
  next();
});

app.get("/health", (req, res) => {
  console.log("✅ HEALTH CHECK");
  res.json({ status: "ok" });
});

app.get("/manifest.json", (req, res) => {
  const lang = req.query.lang || "pt-br";
  console.log(`📋 MANIFEST REQUESTED: ${lang}`);
  const manifest = generateManifest(lang);
  console.log(`📋 MANIFEST SENDING:`, JSON.stringify(manifest));
  res.json(manifest);
});

app.get("/catalog/movie/default.json", (req, res) => {
  console.log("📚 CATALOG MOVIE");
  res.json({ metas: [] });
});

app.get("/catalog/series/default.json", (req, res) => {
  console.log("📚 CATALOG SERIES");
  res.json({ metas: [] });
});

function cleanImdbId(id) {
  return id.replace(/^tt/, "");
}

// ============ SUBTITLES - CRITICAL ============
app.get("/subtitles/movie/:imdbId.json", async (req, res) => {
  console.log(`\n🎬🎬🎬 SUBTITLES/MOVIE REQUEST RECEIVED 🎬🎬🎬`);
  console.log(`   IMDB ID: ${req.params.imdbId}`);
  console.log(`   QUERY: ${JSON.stringify(req.query)}`);
  
  try {
    const imdbId = cleanImdbId(req.params.imdbId);
    const lang = req.query.lang || "pt-br";
    
    console.log(`   CLEAN ID: ${imdbId}`);
    console.log(`   LANG: ${lang}`);
    
    const result = await fetchAndTranslateSubtitle(imdbId, lang);
    
    console.log(`   RESULT:`, result ? "SUCCESS" : "NULL");
    res.json(result || { subtitles: [] });
  } catch (err) {
    console.error(`❌ ERROR:`, err.message);
    console.error(err.stack);
    res.status(500).json({ subtitles: [], error: err.message });
  }
});

app.get("/subtitles/series/:imdbId.json", async (req, res) => {
  console.log(`\n📺📺📺 SUBTITLES/SERIES REQUEST RECEIVED 📺📺📺`);
  console.log(`   IMDB ID: ${req.params.imdbId}`);
  console.log(`   QUERY: ${JSON.stringify(req.query)}`);
  
  try {
    const imdbId = cleanImdbId(req.params.imdbId);
    const lang = req.query.lang || "pt-br";
    
    console.log(`   CLEAN ID: ${imdbId}`);
    console.log(`   LANG: ${lang}`);
    
    const result = await fetchAndTranslateSubtitle(imdbId, lang);
    
    console.log(`   RESULT:`, result ? "SUCCESS" : "NULL");
    res.json(result || { subtitles: [] });
  } catch (err) {
    console.error(`❌ ERROR:`, err.message);
    console.error(err.stack);
    res.status(500).json({ subtitles: [], error: err.message });
  }
});

app.get("/", (req, res) => {
  console.log("📄 HOME");
  res.json({ message: "Auto Translate RDG Addon" });
});

// ============ 404 ============
app.use((req, res) => {
  console.log(`❌ 404: ${req.method} ${req.path}`);
  res.status(404).json({ error: "Not found" });
});

// ============ ERROR ============
app.use((err, req, res, next) => {
  console.error(`❌ SERVER ERROR:`, err.message);
  console.error(err.stack);
  res.status(500).json({ error: err.message });
});

// ============ START ============
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✅✅✅ SERVER STARTED ON PORT ${PORT} ✅✅✅\n`);
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;
