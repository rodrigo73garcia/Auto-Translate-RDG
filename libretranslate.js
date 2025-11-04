import axios from "axios";
import { LIBRETRANSLATE_API } from "./config.js";

export async function translateText(text, targetLang) {
  try {
    // Converter pt-br para pt (LibreTranslate não aceita pt-br)
    const langCode = targetLang === "pt-br" ? "pt" : targetLang;
    
    console.log(`🌐 Traduzindo para: ${langCode}`);
    
    // Dividir em pedaços se muito grande (máximo 5000 caracteres por requisição)
    const chunks = splitTextIntoChunks(text, 5000);
    console.log(`📦 Dividido em ${chunks.length} pedaços`);
    
    let translatedChunks = [];
    
    for (let i = 0; i < chunks.length; i++) {
      try {
        const res = await axios.post(
          `${LIBRETRANSLATE_API}/translate`,
          {
            q: chunks[i],
            source: "auto",
            target: langCode,
            format: "text"
          },
          {
            timeout: 30000,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
        
        translatedChunks.push(res.data.translatedText);
        console.log(`✅ Pedaço ${i + 1}/${chunks.length} traduzido`);
      } catch (err) {
        console.error(`❌ Erro ao traduzir pedaço ${i + 1}:`, err.message);
        translatedChunks.push(chunks[i]); // fallback: retorna original
      }
    }
    
    return translatedChunks.join('\n');
    
  } catch (err) {
    console.error("❌ Erro na tradução:", err.message);
    return text;
  }
}

// Dividir texto em chunks menores
function splitTextIntoChunks(text, maxChunkSize) {
  const lines = text.split('\n');
  const chunks = [];
  let currentChunk = '';
  
  for (let line of lines) {
    if ((currentChunk + line).length > maxChunkSize) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = line;
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line;
    }
  }
  
  if (currentChunk) chunks.push(currentChunk.trim());
  
  return chunks.length > 0 ? chunks : [text];
}
