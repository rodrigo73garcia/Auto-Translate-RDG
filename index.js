import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

// Diretório de cache
const cacheDir = path.join(os.tmpdir(), "subtitle_cache");
await fs.mkdir(cacheDir, { recursive: true });

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function readCache(key) {
  try {
    const filePath = path.join(cacheDir, `${key}.srt`);
    const data = await fs.readFile(filePath, "utf-8");
    return data;
  } catch {
    return null;
  }
}

async function saveCache(key, data) {
  try {
    const filePath = path.join(cacheDir, `${key}.srt`);
    await fs.writeFile(filePath, data, "utf-8");
  } catch (err) {
    console.error("Erro ao salvar cache:", err);
  }
}

// Função para buscar legenda no OpenSubtitles
async function fetchSubtitleFromOpenSubtitles(imdbID) {
  const url = `https://rest.opensubtitles.org/search/imdbid-${imdbID}/sublanguageid-eng`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "TemporaryUserAgent", // obrigatório pela API
    },
  });

  if (!response.ok) {
    throw new Error(`Erro ao buscar no OpenSubtitles: ${response.status}`);
  }

  const results = await response.json();
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error("Nenhuma legenda encontrada.");
  }

  // Pega a primeira legenda com link direto
  const best = results[0];
  const downloadUrl = best.url || best.SubDownloadLink;

  if (!downloadUrl) {
    throw new Error("Legenda sem link de download válido.");
  }

  // Baixa o conteúdo da legenda
  const srtResponse = await fetch(downloadUrl);
  if (!srtResponse.ok) {
    throw new Error("Falha ao baixar o arquivo de legenda.");
  }

  const buffer = await srtResponse.arrayBuffer();
  return Buffer.from(buffer).toString("utf-8");
}

// Função "fake" de tradução (substitua pela sua API real)
function translateFake(srt) {
  return srt.replace(/([A-Za-z]+)/g, "$1_PT");
}

// --- ROTA PRINCIPAL ---
app.get("/subtitles/:type/:imdbParam(*)", async (req, res) => {
  const { type, imdbParam } = req.params;
  const imdbID = imdbParam.replace(/\D/g, ""); // limpa apenas os números
  const cacheKey = `${type}_${imdbID}`;

  log(`Nova requisição -> type: ${type}, imdb: ${imdbID}`);

  try {
    // Verifica cache
    const cached = await readCache(cacheKey);
    if (cached) {
      log(`Cache encontrado: ${cacheKey}`);
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.send(cached);
    }

    // Busca legenda no OpenSubtitles
    const originalSrt = await fetchSubtitleFromOpenSubtitles(imdbID);
    log(`Legenda original obtida (${originalSrt.length} bytes)`);

    // Tradução (simulada)
    const translated = translateFake(originalSrt);

    // Salva cache
    await saveCache(cacheKey, translated);
    log(`Legenda traduzida salva: ${cacheKey}`);

    // Envia resposta
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(translated);
  } catch (err) {
    console.error("Erro na rota:", err);
    res.status(500).send("Erro ao processar legenda.");
  }
});

// Rota de status
app.get("/", (req, res) => {
  res.send("🟢 Auto-Translate API com OpenSubtitles ativa.");
});

app.listen(PORT, () => {
  log(`Servidor iniciado na porta ${PORT}`);
});
