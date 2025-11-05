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

// Diretório de cache para legendas
const subtitlesDir = path.join(__dirname, "subtitles");
await fs.ensureDir(subtitlesDir);

// Função utilitária de cache
const cacheFilePath = (type, imdb, lang) =>
  path.join(subtitlesDir, `${type}_${imdb}_${lang}.srt`);

// Função de tradução usando google-translate-api-x
async function traduzirTexto(texto, lang) {
  try {
    const res = await translate(texto, { to: lang });
    return res.text;
  } catch (err) {
    console.error("Erro ao traduzir trecho:", err.message);
    return texto; // retorna original em caso de erro
  }
}

// Rota principal: traduz legenda e salva em cache
app.get("/subtitles/:type/:imdb", async (req, res) => {
  const { type, imdb } = req.params;
  const lang = req.query.lang || "pt";
  console.log(`[${new Date().toISOString()}] Nova requisição -> type: ${type}, imdb: ${imdb}`);

  const cachePath = cacheFilePath(type, imdb, lang);

  try {
    // Se já existe no cache, retorna direto
    if (await fs.pathExists(cachePath)) {
      console.log("Legenda servida do cache:", cachePath);
      const cached = await fs.readFile(cachePath, "utf-8");
      return res.type("text/plain").send(cached);
    }

    // Busca legenda original via OpenSubtitles API pública
    const url = `https://rest.opensubtitles.org/search/imdbid-${imdb}/sublanguageid-eng`;
    const response = await fetch(url, {
      headers: { "User-Agent": "TemporaryUserAgent" },
    });

    if (!response.ok) throw new Error("Erro ao buscar legenda original.");
    const data = await response.json();

    if (!data || !data.length || !data[0].SubDownloadLink)
      throw new Error("Legenda não encontrada para este IMDb.");

    const subtitleUrl = data[0].SubDownloadLink.replace(".gz", "");
    const subResp = await fetch(subtitleUrl);
    const originalSubtitle = await subResp.text();

    console.log(`[${new Date().toISOString()}] Legenda original obtida (${originalSubtitle.length} bytes)`);

    // Tradução linha a linha (com pequenos blocos)
    const linhas = originalSubtitle.split("\n");
    const blocos = [];
    let blocoAtual = [];

    for (const linha of linhas) {
      if (/^\d+$/.test(linha) || linha.includes("-->")) {
        if (blocoAtual.length) {
          blocos.push(blocoAtual.join(" "));
          blocoAtual = [];
        }
        blocos.push(linha);
      } else if (linha.trim() === "") {
        if (blocoAtual.length) {
          blocos.push(blocoAtual.join(" "));
          blocoAtual = [];
        }
        blocos.push("");
      } else {
        blocoAtual.push(linha);
      }
    }

    if (blocoAtual.length) blocos.push(blocoAtual.join(" "));

    const traduzido = [];
    for (const bloco of blocos) {
      if (/^\d+$/.test(bloco) || bloco.includes("-->") || bloco.trim() === "") {
        traduzido.push(bloco);
      } else {
        const traduzidoTexto = await traduzirTexto(bloco, lang);
        traduzido.push(traduzidoTexto);
      }
    }

    const legendaTraduzida = traduzido.join("\n");

    // Salva no cache
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
