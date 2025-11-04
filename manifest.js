import { TRANSLATION_LANGUAGES } from "./config.js";

export function generateManifest(lang = "pt-br") {
  // Normalizar idioma recebido pela URL
  let targetLang = "pt-BR";
  
  if (lang) {
    // Se veio da URL com nome completo, converter
    if (lang === "Português (Brasil)" || lang.includes("Brasil")) {
      targetLang = "pt-BR";
    } else if (lang === "Português (Portugal)" || lang.includes("Portugal")) {
      targetLang = "pt";
    } else {
      // Usar o código direto
      targetLang = lang;
    }
  }

  const manifest = {
    id: `org.rdg.autotranslate.${targetLang}`,  // ID único por idioma
    version: "2.0.0",
    name: `Auto Translate RDG (${targetLang})`,
    description: `Traduz legendas automaticamente para ${targetLang}`,
    
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [],
    
    contactEmail: "rdgaddons@outlook.com",
    behaviorHints: {
      configurable: false,
      configurationRequired: false
    }
  };

  return manifest;
}
