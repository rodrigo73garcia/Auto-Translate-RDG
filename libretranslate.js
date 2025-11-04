import axios from "axios";
import { v2 as GoogleTranslate } from "@google-cloud/translate";

// Tenta inicializar cliente do Google (se houver credenciais)
let googleClient = null;
try {
  // Requer GOOGLE_APPLICATION_CREDENTIALS apontando para o JSON da service account
  googleClient = new GoogleTranslate.Translate();
  console.log("🟢 Google Cloud Translation habilitado");
} catch (e) {
  console.warn("🟡 Google Cloud Translation indisponível, usando fallback quando necessário:", e.message);
}

export async function translateText(text, targetLang) {
  // Normaliza códigos pt
  const langCode = targetLang === "pt-br" ? "pt-BR" : targetLang.toUpperCase();

  // 1) Tenta Google Cloud com chunks grandes (até 5000 chars por chamada)
  if (googleClient) {
    try {
      const chunks = splitTextIntoChunks(text, 5000);
      console.log(`📦 [Google] ${chunks.length} chunks → ${langCode}`);
      const translatedChunks = [];
      for (let i = 0; i < chunks.length; i++) {
        const [result] = await googleClient.translate(chunks[i], langCode);
        translatedChunks.push(Array.isArray(result) ? result[0] : result);
      }
      return translatedChunks.join("\n");
    } catch (err) {
      console.error("❌ [Google] falhou, irá tentar fallback:", err.message);
    }
  }

  // 2) Fallback: MyMemory com chunks médios e backoff
  return await translateWithMyMemory(text, langCode);
}

async function translateWithMyMemory(text, langCode) {
  const chunks = splitTextIntoChunks(text, 1500);
  console.log(`📦 [MyMemory] ${chunks.length} chunks → ${langCode}`);

  const translatedChunks = [];
  for (let i = 0; i < chunks.length; i++) {
    let translated = false;
    let retries = 0;
    const maxRetries = 3;

    while (!translated && retries < maxRetries) {
      try {
        const resp = await axios.get("https://api.mymemory.translated.net/get", {
          params: { q: chunks[i], langpair: `en|${langCode}` },
          timeout: 15000
        });
        if (resp.data.responseStatus === 200) {
          translatedChunks.push(resp.data.responseData.translatedText);
          console.log(`✅ [MyMemory] ${i + 1}/${chunks.length}`);
          translated = true;
        } else {
          console.warn(`⚠️ [MyMemory] status ${resp.data.responseStatus}, usando original`);
          translatedChunks.push(chunks[i]);
          translated = true;
        }
      } catch (err) {
        retries++;
        if (err.response?.status === 429) {
          const wait = Math.pow(2, retries) * 1000;
          console.warn(`⏱️ [MyMemory] rate limit, aguardando ${wait}ms…`);
          await sleep(wait);
        } else if (err.response?.status === 403) {
          console.warn("🚫 [MyMemory] 403 proibido, usando original");
          translatedChunks.push(chunks[i]);
          translated = true;
        } else {
          console.error(`❌ [MyMemory] erro no chunk ${i + 1}:`, err.message);
          if (retries >= maxRetries) {
            translatedChunks.push(chunks[i]);
            translated = true;
          } else {
            await sleep(Math.pow(2, retries) * 500);
          }
        }
      }
    }

    if (i < chunks.length - 1) await sleep(400); // pacing leve entre chamadas
  }
  return translatedChunks.join("\n");
}

function splitTextIntoChunks(text, maxChunkSize) {
  const lines = text.split("\n");
  const chunks = [];
  let current = "";

  for (const line of lines) {
    // Linha isolada gigante
    if (line.length > maxChunkSize) {
      if (current) chunks.push(current.trim());
      chunks.push(line);
      current = "";
      continue;
    }
    // Estouro ao adicionar
    if ((current + line).length > maxChunkSize) {
      if (current) chunks.push(current.trim());
      current = line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [text];
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
