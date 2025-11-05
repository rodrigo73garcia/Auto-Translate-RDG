import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import os from "os";


// Define diretórios base
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cria o app express
const app = express();

// Porta automática (Render usa process.env.PORT)
const PORT = process.env.PORT || 3000;

// Caminho do cache em disco
const cacheDir = path.join(os.tmpdir(), "subtitle_cache");

// Garante que o cache exista
await fs.mkdir(cacheDir, { recursive: true });

// Função auxiliar de log
function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// Função para ler do cache
async function readCache(key) {
  try {
    const filePath = path.join(cacheDir, `${key}.srt`);
    const data = await fs.readFile(filePath, "utf-8");
    return data;
  } catch {
    return null;
  }
}

// Função para salvar no cache
async function saveCache(key, data) {
  try {
    const filePath = path.join(cacheDir, `${key}.srt`);
    await fs.writeFile(filePath, data, "utf-8");
  } catch (err) {
    console.error("Erro ao salvar cache:", err);
  }
}

// --- ROTA PRINCIPAL ---
app.get("/subtitles/:type/:imdbParam(*)", async (req, res) => {
  const { type, imdbParam } = req.params;
  const cacheKey = `${type}_${imdbParam.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  log(`Nova requisição recebida -> type: ${type}, imdb: ${imdbParam}`);

  try {
    // 1️⃣ Verifica cache
    const cached = await readCache(cacheKey);
    if (cached) {
      log(`Cache encontrado para ${cacheKey}`);
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.send(cached);
    }

    // 2️⃣ Busca legenda original
    const originalUrl = `https://yoursubtitleapi.example.com/${type}/${imdbParam}`;
    const response = await fetch(originalUrl);
    if (!response.ok) throw new Error("Falha ao obter legenda original");

    const originalSubtitle = await response.text();

    // 3️⃣ Tradução (simulação aqui, troque pela sua API real)
    const translatedSubtitle = originalSubtitle.replace(
      /([A-Za-z]+)/g,
      "$1_PT"
    );

    // 4️⃣ Salva no cache
    await saveCache(cacheKey, translatedSubtitle);
    log(`Legenda traduzida e salva em cache: ${cacheKey}`);

    // 5️⃣ Retorna legenda
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(translatedSubtitle);
  } catch (err) {
    console.error("Erro na rota:", err);
    res.status(500).send("Erro ao processar legenda.");
  }
});

// --- ROTA DE STATUS ---
app.get("/", (req, res) => {
  res.send("🟢 Auto-Translate API ativa e rodando.");
});

// --- INICIA SERVIDOR ---
app.listen(PORT, () => {
  log(`Servidor iniciado na porta ${PORT}`);
});
