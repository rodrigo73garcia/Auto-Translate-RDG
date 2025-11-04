import { TRANSLATION_LANGUAGES } from "./config.js";

export function generateManifest(lang = "pt-br") {
  // Normalizar código de idioma
  const langCode = lang === "Português (Brasil)" || lang === "pt-br" ? "pt-BR" : lang;

  const manifest = {
    // ========== CAMPOS OBRIGATÓRIOS ==========
    id: "org.rdg.autotranslate", 
    version: "2.0.0",
    name: "Auto Translate RDG",
    description: "Traduz legendas automaticamente para português e outros idiomas",
    
    // ========== RECURSOS E TIPOS ==========
    resources: ["subtitles"],  // Array obrigatório
    types: ["movie", "series"],
    idPrefixes: ["tt"],  // Stremio passa IMDb IDs com "tt"
    
    // ========== CATALOGS (necessário, mesmo vazio) ==========
    catalogs: [],  // Array vazio é válido
    
    // ========== CONFIGURAÇÃO DE IDIOMA ==========
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
    
    // ========== OPCIONAL MAS RECOMENDADO ==========
    logo: "https://auto-translate-rdg.onrender.com/icon.png",
    background: "https://auto-translate-rdg.onrender.com/bg.jpg",
    contactEmail: "rdgaddons@outlook.com",
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    }
  };

  return manifest;
}
