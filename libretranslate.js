import axios from "axios";
import { LIBRETRANSLATE_API } from "./config.js";

export async function translateText(text, targetLang) {
  try {
    const res = await axios.post(`${LIBRETRANSLATE_API}/translate`, {
      q: text,
      source: "auto",
      target: targetLang,
      format: "text"
    });
    return res.data.translatedText;
  } catch (err) {
    console.error("❌ Erro na tradução:", err.message);
    return text; // fallback
  }
}
