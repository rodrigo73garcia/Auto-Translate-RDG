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
    
    const text = subData.data.toString();

    // Traduzir
    const translated = await translateText(text, targetLang);

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
