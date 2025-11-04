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

app.get("/health", (req, res) => {
  console.log("✅ HEALTH");
  res.json({ status: "ok" });
});

app.get("/manifest.json", (req, res) => {
  const lang = req.query.lang || "pt-br";
  console.log(`📋 MANIFEST | Lang: ${lang}`);
  const manifest = generateManifest(lang);
  res.json(manifest);
});

app.get("/catalog/movie/default.json", (req, res) => res.json({ metas: [] }));
app.get("/catalog/series/default.json", (req, res) => res.json({ metas: [] }));

function cleanImdbId(id) {
  return id.replace(/^tt/, "");
}

app.get("/subtitles/movie/:imdbId.json", async (req, res) => {
  try {
    const imdbId = cleanImdbId(req.params.imdbId);
    const lang = req.query.lang || "pt-br";
    const result = await fetchAndTranslateSubtitle(imdbId, lang);
    res.json(result || { subtitles: [] });
  } catch (err) {
    console.error("❌ MOVIE ERROR:", err.message);
    res.json({ subtitles: [] });
  }
});

app.get("/subtitles/series/:imdbId.json", async (req, res) => {
  try {
    const imdbId = cleanImdbId(req.params.imdbId);
    const lang = req.query.lang || "pt-br";
    const result = await fetchAndTranslateSubtitle(imdbId, lang);
    res.json(result || { subtitles: [] });
  } catch (err) {
    console.error("❌ SERIES ERROR:", err.message);
    res.json({ subtitles: [] });
  }
});

app.get("/", (req, res) => {
  res.json({ message: "Auto Translate RDG" });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ SERVER ON PORT ${PORT}`);
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;
