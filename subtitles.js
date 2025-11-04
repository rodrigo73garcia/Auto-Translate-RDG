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
    console.log(`🔍 Buscando em: ${apiUrl}`);
    
    const res = await axios.get(apiUrl, {
      headers: { 
        "User-Agent": "AutoTranslateRDG v2.0.0"
      },
      timeout: 15000
    });

    if (!res.data || res.data.length === 0) {
      console.log("🚫 Nenhuma legenda original encontrada.");
      return null;
    }

    console.log(`✅ Encontradas ${res.data.length} legendas`);

    // Pegar legenda principal em inglês
    const mainSub = res.data[0];
    const downloadUrl = mainSub.SubDownloadLink?.replace(".gz", "");
    
    if (!downloadUrl) {
      console.log("🚫 URL de download não disponível");
      return null;
    }
    
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
    
    if (!subData.data) {
      console.log("🚫 Nenhum conteúdo no arquivo SRT");
      return null;
    }
    
    const srtContent = subData.data.toString();
    console.log(`📦 Arquivo SRT baixado: ${srtContent.length} caracteres`);
    
    // Extrair apenas o texto das legendas
    const textOnly = extractSRTText(srtContent);
    
    if (!textOnly || textOnly.trim().length === 0) {
      console.log("🚫 Nenhum texto extraído do arquivo SRT.");
      return null;
    }

    console.log(`📄 Texto extraído: ${textOnly.substring(0, 100)}...`);
    
    // Traduzir
    const translated = await translateText(textOnly, targetLang);

    const translatedSub = {
      id: "auto-translated",
      lang: `${targetLang} (Auto Translate RDG)`,
      url: mainSub.SubDownloadLink,
      originalLang: mainSub.LanguageName
    };

    cache.set(cacheKey, { subtitles: [translatedSub] });
    console.log(`✅ Legenda traduzida para ${targetLang} ✨`);
    
    return { subtitles: [translatedSub] };

  } catch (err) {
    console.error("❌ Erro geral ao buscar/traduzir legenda:", err.message);
    console.error("Stack:", err.stack);
    return null;
  }
}

// Função para extrair apenas o texto do arquivo SRT
function extractSRTText(srtContent) {
  try {
    const lines = srtContent.split('\n');
    const textLines = [];
    
    // Lista de palavras e padrões a ignorar
    const ignorePatterns = [
      /support.*vip/i,
      /opensubtitles/i,
      /www\./i,
      /http/i,
      /ads/i,
      /remove.*ads/i,
      /^#/
    ];

    for (let line of lines) {
      const trimmedLine = line.trim();
      
      // Pular linhas vazias, números, timestamps e URLs
      if (trimmedLine === '' || 
          /^\d+$/.test(trimmedLine) ||
          /\d{2}:\d{2}:\d{2}/.test(trimmedLine) ||
          trimmedLine.startsWith('http')) {
        continue;
      }
      
      // Pular linhas que correspondem aos padrões de publicidade
      let shouldSkip = false;
      for (let pattern of ignorePatterns) {
        if (pattern.test(trimmedLine)) {
          shouldSkip = true;
          break;
        }
      }
      
      if (shouldSkip) {
        continue;
      }
      
      if (trimmedLine.length > 0) {
        textLines.push(trimmedLine);
      }
    }

    const result = textLines.join('\n');
    console.log(`✅ Extração SRT concluída: ${result.length} caracteres`);
    return result;
  } catch (err) {
    console.error("❌ Erro ao extrair SRT:", err.message);
    return srtContent;
  }
}
