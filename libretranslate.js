import axios from "axios";
import { LIBRETRANSLATE_API } from "./config.js";

export async function translateText(text, targetLang) {
  try {
    // Converter pt-br para pt (LibreTranslate não aceita pt-br)
    const langCode = targetLang === "pt-br" ? "pt" : targetLang;
    
    console.log(`🌐 Traduzindo para: ${langCode}`);
    
    const res = await axios.post(`${LIBRETRANSLATE_API}/translate`, {
      q: text,
      source: "auto",
      target: langCode,
      format: "text"
    });

    return res.data.translatedText;
    
  } catch (err) {
    console.error("❌ Erro na tradução:", err.message);
    return text; // fallback
  }
}
