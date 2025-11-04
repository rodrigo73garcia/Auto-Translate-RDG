import { translate as gTranslate } from "google-translate-api-x";

function splitIntoChunks(text, max = 4500) {
  const lines = text.split("\n");
  const chunks = [];
  let buf = "";
  for (const line of lines) {
    if ((buf + (buf ? "\n" : "") + line).length > max) {
      if (buf.trim()) chunks.push(buf.trim());
      buf = line;
    } else {
      buf += (buf ? "\n" : "") + line;
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.length ? chunks : [text];
}

export async function translateText(text, targetLang) {
  const langMap = {
    "pt-BR": "pt",
    "pt-PT": "pt",
    "pt": "pt",
    "en": "en",
    "es": "es",
    "fr": "fr"
  };
  
  const to = langMap[targetLang] || targetLang;
  
  console.log(`🌐 TRANSLATING TO: ${to}`);
  
  try {
    const chunks = splitIntoChunks(text, 4500);
    console.log(`📦 ${chunks.length} chunks`);
    
    const results = [];
    for (let i = 0; i < chunks.length; i++) {
      try {
        const res = await gTranslate(chunks[i], { to, client: "gtx", tld: "com" });
        results.push(res.text || chunks[i]);
        console.log(`✅ Chunk ${i + 1}/${chunks.length} OK`);
      } catch (err) {
        console.error(`❌ Chunk ${i + 1}:`, err.message);
        results.push(chunks[i]);
      }
      await new Promise(r => setTimeout(r, 200));
    }
    
    return results.join("\n");
  } catch (err) {
    console.error("❌ TRANSLATION ERROR:", err.message);
    return text;
  }
}
