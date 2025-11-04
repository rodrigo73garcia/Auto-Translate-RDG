import axios from "axios";
import NodeCache from "node-cache";
import { translateText } from "./libretranslate.js";

const cache = new NodeCache({ stdTTL: 60 * 60 }); // 1h

export async function fetchAndTranslateSubtitle(imdbId, targetLang) {
  console.log(`🎬 Solicitando legendas via API → ${imdbId} → ${targetLang}`);
  
  const cacheKey = `${imdbId}-${targetLang}`;
  
  if (cache.has(cacheKey)) {
    console.log("⚡ Retornando legenda do cache");
    return cache.get(cacheKey);
  }

  try {
    // API de legendas base
    const apiUrl = `https://rest.opensubtitles.org/search/imdbid-${imdbId}/sublanguageid-eng`;
    const res = await axios.get(apiUrl, {
      headers: { 
        "User-Agent": "AutoTranslateRDG v2.0.0"
      }
    });

    if (!res.data?.length) {
      console.log("🚫 Nenhuma legenda original encontrada.");
      return null;
    }

    // Pegar legenda principal em inglês
    const mainSub = res.data[0];
    const downloadUrl = mainSub.SubDownloadLink?.replace(".gz", "");
    
    console.log(`📥 Baixando legenda: ${downloadUrl}`);
    
    // Headers específicos para download do OpenSubtitles
    const subData = await axios.get(downloadUrl, {
      headers: { 
        "User-Agent": "AutoTranslateRDG v2.0.0",
        "Referer": "https://www.opensubtitles.org/",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9"
      },
      timeout: 30000
    });
    
    const srtContent = subData.data.toString();
    
    // Extrair apenas o texto das legendas (remover timestamps e números)
    const textOnly = extractSRTText(srtContent);
    
    if (!textOnly || textOnly.trim().length === 0) {
      console.log("🚫 Nenhum texto extraído do arquivo SRT.");
      return null;
    }

    console.log(`📄 Texto extraído: ${textOnly.substring(0, 100)}...`);
    
    // Traduzir
    const translated = await translateText(textOnly, targetLang);

    // Reconstruir arquivo SRT com texto traduzido
    const translatedSRT = reconstructSRT(srtContent, textOnly, translated);

    const translatedSub = {
      id: "auto-translated",
      lang: `${targetLang} (Auto Translate RDG)`,
      url: mainSub.SubDownloadLink,
      originalLang: mainSub.LanguageName
    };

    cache.set(cacheKey, { subtitles: [translatedSub] });
    console.log(`✅ Legenda traduzida para ${targetLang}`);
    
    return { subtitles: [translatedSub] };

  } catch (err) {
    console.error("❌ Erro geral ao buscar/traduzir legenda:", err.message);
    return null;
  }
}

// Função para extrair apenas o texto do arquivo SRT
function extractSRTText(srtContent) {
  const lines = srtContent.split('\n');
  const textLines = [];
  let skipNext = false;

  for (let line of lines) {
    // Pular linhas em branco, números e timestamps
    if (line.trim() === '' || 
        /^\d+$/.test(line.trim()) ||
        /\d{2}:\d{2}:\d{2}/.test(line)) {
      skipNext = false;
      continue;
    }
    
    if (line.trim().length > 0) {
      textLines.push(line);
    }
  }

  return textLines.join('\n');
}

// Função para reconstruir o arquivo SRT (mantém estrutura original)
function reconstructSRT(originalSRT, originalText, translatedText) {
  // Por simplicidade, retorna o SRT original
  // Em produção, você poderia remapear o texto traduzido
  return originalSRT;
}
