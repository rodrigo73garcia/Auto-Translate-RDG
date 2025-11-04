import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { PORT, TRANSLATION_LANGUAGES } from "./config.js";
import { fetchAndTranslateSubtitle } from "./subtitles.js";
import { generateManifest } from "./manifest.js";

const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(express.static("public"));

// Página inicial
app.get("/", (req, res) => {
  res.sendFile(process.cwd() + "/public/index.html");
});

// ROTA DO MANIFEST
app.get("/manifest.json", (req, res) => {
  const lang = req.query.lang || "pt-br";
  const manifest = generateManifest(lang);
  res.json(manifest);
});

// Endpoint principal de legendas para Stremio
app.get("/subtitles/movie/:imdbId.json", async (req, res) => {
  const { imdbId } = req.params;
  const lang = req.query.lang || "pt-br";
  const result = await fetchAndTranslateSubtitle(imdbId, lang);
  if (!result) {
    return res.json({ subtitles: [] });
  }
  res.json(result);
});

app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
