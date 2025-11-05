import express from "express";
import cors from "cors";
import morgan from "morgan";
import fs from "fs-extra";
import path from "path";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import translate from "google-translate-api-x";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(morgan("dev"));

const subtitlesDir = path.join(__dirname, "subtitles");
await fs.ensureDir(subtitlesDir);

const cacheFilePath = (type, imdb, lang) =>
  path.join(subtitlesDir, `${type}_${imdb}_${lang}.srt`);

// Tradução segura com timeout
async function safeTranslate(text, lang) {
  const timeoutMs = 30000; // 30s por bloco
  return Promise.race([
    translate(text, { to: lang }).then((r) => r.text),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout de tradução")), timeoutMs)
    ),
  ]).catch((err) => {
    console.error("Erro traduzindo bloco:", err.message);
    return text;
  });
}

// Divide array em pedaços
const chunkArray = (arr, size) => {
  const result = [];
  for (let i = 0; i < arr.length; i += size)
    result.push(arr.slice(i, i + size));
  return result;
};

app.get("/subtitles/:type/:imdb", async (req, res) => {
  const { type, imdb } = req.params;
  const lang = req.query.lang || "pt";
  const cachePath = cacheFilePath(type, imdb, lang);

  console.log(`[${new Date().toISOString()}] Nova requisição -> type: ${type}, imdb: ${imdb}`);

  try {
    if (await fs.pathExists(cachePath)) {
      console.log("Legenda servida do cache:", cachePath);
      return res.type("text/plain").send(await fs.readFile(cachePath, "utf-8"));
    }

    const url = `https://rest.opensubtitles.org/search/imdbid-${imdb}/sublanguageid-eng`;
    const response = await fetch(url, { headers: { "User-Agent": "TemporaryUserAgent" } });
    if (!response.ok) throw new Error("Erro ao buscar legenda original.");
    const data = await response.json();
    if (!data?.length || !data[0].SubDownloadLink) throw new Error("Legenda não encontrada.");

    const subtitleUrl = data[0].SubDownloadLink.replace(".gz", "");
    const subResp = await fetch(subtitleUrl);
    const originalSubtitle = await subResp.text();

    console.log(`[${new Date().toISOString()}] Legenda original obtida (${originalSubtitle.length} bytes)`);

    const linhas = originalSubtitle.split("\n");
    const blocos = chunkArray(linhas, 500); // 500 linhas por bloco
    const traduzido = [];

    console.log(`Traduzindo ${blocos.length} blocos (${linhas.length} linhas totais)...`);

    // Traduz até 3 blocos em paralelo
    const concurrency = 3;
    for (let i = 0; i < blocos.length; i += concurrency) {
      const batch = blocos.slice(i, i + concurrency);
      console.log(`Traduzindo blocos ${i + 1} a ${i + batch.length}...`);
      const results = await Promise.all(
        batch.map((b, idx) =>
          safeTranslate(b.join("\n"), lang).then((txt) => {
            console.log(`✔️ Bloco ${i + idx + 1} traduzido`);
            return txt;
          })
        )
      );
      traduzido.push(...results);
    }

    const legendaTraduzida = traduzido.join("\n");

    await fs.writeFile(cachePath, legendaTraduzida, "utf-8");
    console.log(`[${new Date().toISOString()}] Legenda traduzida salva: ${path.basename(cachePath)}`);

    res.type("text/plain").send(legendaTraduzida);
  } catch (err) {
    console.error("Erro na rota:", err);
    res.status(500).send("Erro ao processar legenda.");
  }
});

app.listen(PORT, () => {
  console.log(`Servidor iniciado na porta ${PORT}`);
});
