import axios from "axios";
import NodeCache from "node-cache";
import { translateText } from "./translator.js";

const cache = new NodeCache({ stdTTL: 60 * 60 }); // 1h

export async function fetchAndTranslateSubtitle(imdbId, targetLang) {
  console.log(`🎬 Solicitando legendas via API → ${imdbId} → ${targetLang}`);

  const cacheKey = `${imdbId}-${targetLang}`;
  if (cache.has(cacheKey)) {
    console.log("⚡ Retornando legenda do cache");
    return cache.get(cacheKey);
  }

  try {
    const apiUrl = `https://rest.opensubtitles.org/search/imdbid-${imdbId}/sublanguageid-eng`;
    console.log(`🔍 Buscando em: ${apiUrl}`);

    const res = await axios.get(apiUrl, {
      headers: { "User-Agent": "AutoTranslateRDG v2.0.0" },
      timeout: 15000
    });

    if (!res.data || res.data.length === 0) {
      console.log("🚫 Nenhuma legenda original encontrada.");
      return null;
    }

    console.log(`✅ Encontradas ${res.data.length} legendas`);
    const mainSub = res.data[0];
    const downloadUrl = mainSub.SubDownloadLink?.replace(".gz", "");
    if (!downloadUrl) {
      console.log("🚫 URL de download não disponível");
      return null;
    }

    console.log(`📥 Baixando legenda: ${downloadUrl}`);
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

    const textOnly = extractSRTText(srtContent);
    if (!textOnly || textOnly.trim().length === 0) {
      console.log("🚫 Nenhum texto extraído do arquivo SRT.");
      return null;
    }

    console.log(`📄 Texto extraído: ${textOnly.substring(0, 100)}...`);

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
    return null;
  }
}

function extractSRTText(srtContent) {
  try {
    const lines = srtContent.split("\n");
    const textLines = [];
    const ignorePatterns = [
      /support.*vip/i,
      /opensubtitles/i,
      /www\./i,
      /http/i,
      /ads/i,
      /remove.*ads/i,
      /^#/
    ];

    for (const line of lines) {
      const t = line.trim();
      if (
        t === "" ||
        /^\d+$/.test(t) ||
        /\d{2}:\d{2}:\d{2}/.test(t) ||
        t.startsWith("http")
      ) {
        continue;
      }
      if (ignorePatterns.some(p => p.test(t))) continue;
      textLines.push(t);
    }
    const out = textLines.join("\n");
    console.log(`✅ Extração SRT concluída: ${out.length} caracteres`);
    return out;
  } catch (e) {
    console.error("❌ Erro ao extrair SRT:", e.message);
    return srtContent;
  }
}
