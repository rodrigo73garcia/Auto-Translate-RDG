import { TRANSLATION_LANGUAGES } from "./config.js";

export function generateManifest(lang = "pt-br") {
  const langCode = lang === "Português (Brasil)" || lang === "pt-br" ? "pt-BR" : lang;

  const manifest = {
    id: "org.rdg.autotranslate", 
    version: "2.0.0",
    name: "Auto Translate RDG",
    description: "Traduz legendas automaticamente para português e outros idiomas",
    
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: [],
    
    config: [
      {
        key: "language",
        label: "Subtitle Language",
        type: "select",
        default: "pt-BR",
        options: TRANSLATION_LANGUAGES.map(l => ({
          key: l.code.toUpperCase() === "PT-BR" ? "pt-BR" : l.code,
          label: l.name
        }))
      }
    ],
    
    // ⚠️ REMOVIDO: logo e background causam rejeição do Stremio
    contactEmail: "rdgaddons@outlook.com",
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    }
  };

  return manifest;
}
