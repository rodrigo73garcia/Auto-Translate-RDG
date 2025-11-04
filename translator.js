import { translate as gTranslate, isSupported, getCode } from "google-translate-api-x";

// Normaliza códigos pt e seleciona TLD brasileiro quando pedido "pt-br"
function normalizeTarget(targetLang) {
  if (!targetLang) return { to: "pt", tld: "com.br" };
  const lang = targetLang.toLowerCase();
  if (lang === "pt-br" || lang === "pt_br" || lang === "ptbr") {
    return { to: "pt", tld: "com.br" }; // Google não diferencia código, mas TLD ajuda no flavour
  }
  if (lang === "pt-pt" || lang === "pt_pt") {
    return { to: "pt", tld: "pt" };
  }
  const code = isSupported(lang) ? getCode(lang) : "pt";
  return { to: code, tld: "com" };
}

// Divide respeitando ~4.500 chars por bloco (abaixo do limite de 5.000 do endpoint)
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
  const { to, tld } = normalizeTarget(targetLang);
  // google-translate-api-x aceita array/objeto para batch em UMA chamada
  // Mas respeitamos 5.000 chars por request (documentado), então mandamos como array de chunks
  const chunks = splitIntoChunks(text, 4500);
  try {
    // client: "gtx" ajuda a evitar 403 conforme instrução do pacote
    // Também setamos tld para adequar a variante local quando possível
    const res = await gTranslate(chunks, { to, client: "gtx", tld });
    // A API retorna array de objetos no mesmo formato do input
    const translated = Array.isArray(res)
      ? res.map(r => r.text).join("\n")
      : res.text;
    return translated;
  } catch (err) {
    // Fallback simples: retorna original se tudo falhar
    console.error("translator.js erro:", err.message);
    return text;
  }
}
