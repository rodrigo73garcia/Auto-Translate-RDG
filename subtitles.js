import axios from "axios";
import NodeCache from "node-cache";
import { translateText } from "./translator.js";

const cache = new NodeCache({ stdTTL: 60 * 60 });

export async function fetchAndTranslateSubtitle(imdbId, targetLang) {
  console.log(`\n🎬 FETCH REQUEST: ${imdbId} | Lang: ${targetLang}`);

  const cacheKey = `${imdbId}-${targetLang}`;
  if (cache.has(cacheKey)) {
    console.log("⚡ CACHE HIT");
    return cache.get(cacheKey);
  }

  try {
    const apiUrl = `https://rest.opensubtitles.org/search/imdbid-${imdbId}/sublanguageid-eng`;
    console.log(`🔍 SEARCHING: ${apiUrl}`);

    const res = await axios.get(apiUrl, {
      headers: { "User-Agent": "AutoTranslateRDG/2.0" },
      timeout: 15000
    });

    if (!res.data?.length) {
      console.log("🚫 NO SUBTITLES FOUND");
      return null;
    }

    console.log(`✅ FOUND ${res.data.length} subtitles`);
    const mainSub = res.data[0];
    const downloadUrl = mainSub.SubDownloadLink?.replace(".gz", "");

    if (!downloadUrl) {
      console.log("🚫 NO DOWNLOAD URL");
      return null;
    }

    console.log(`📥 DOWNLOADING: ${downloadUrl.substring(0, 80)}...`);
    const subData = await axios.get(downloadUrl, {
      headers: {
        "User-Agent": "AutoTranslateRDG/2.0",
        "Referer": "https://www.opensubtitles.org/"
      },
      timeout: 30000
    });

    const srtContent = subData.data.toString();
    console.log(`📦 SRT SIZE: ${srtContent.length} chars`);

    const textOnly = extractSRTText(srtContent);
    if (!textOnly?.trim()) {
      console.log("🚫 NO TEXT EXTRACTED");
      return null;
    }

    console.log(`📄 EXTRACTED: ${textOnly.length} chars`);
    console.log(`📄 SAMPLE: ${textOnly.substring(0, 80)}...`);

    const translated = await translateText(textOnly, targetLang);

    const result = {
      subtitles: [
        {
          id: "auto-translated",
          lang: `${targetLang} (Auto Translate RDG)`,
          url: mainSub.SubDownloadLink,
          originalLang: mainSub.LanguageName
        }
      ]
    };

    cache.set(cacheKey, result);
    console.log(`✅ TRANSLATION COMPLETE`);

    return result;
  } catch (err) {
    console.error("❌ FETCH ERROR:", err.message);
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
      /ads/i
    ];

    for (const line of lines) {
      const t = line.trim();
      if (t === "" || /^\d+$/.test(t) || /\d{2}:\d{2}:\d{2}/.test(t) || t.startsWith("http")) continue;
      if (ignorePatterns.some(p => p.test(t))) continue;
      textLines.push(t);
    }

    return textLines.join("\n");
  } catch (e) {
    console.error("❌ EXTRACT ERROR:", e.message);
    return srtContent;
  }
}
