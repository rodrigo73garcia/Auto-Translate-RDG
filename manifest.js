import { TRANSLATION_LANGUAGES } from "./config.js";

export function generateManifest(lang = "pt-br") {
  const manifest = {
    id: "org.rdg.autotranslate",
    version: "2.0.0",
    name: "Auto Translate RDG",
    description: "Traduz automaticamente legendas para o idioma selecionado usando Google Translate (gratuito).",
    logo: "https://auto-translate-rdg.onrender.com/icon.png",
    background: "https://auto-translate-rdg.onrender.com/bg.jpg",
    contactEmail: "rdgaddons@outlook.com",
    
    // Campos essenciais para Stremio reconhecer
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    },
    
    // Configuração de idioma
    config: [
      {
        key: "language",
        label: "Idioma das Legendas",
        type: "select",
        default: "pt-br",
        options: TRANSLATION_LANGUAGES.map(l => ({
          key: l.code,
          label: l.name
        }))
      }
    ],
    
    // Importante: addon deve responder a catalog mesmo que vazio
    catalogs: []
  };

  return manifest;
}
