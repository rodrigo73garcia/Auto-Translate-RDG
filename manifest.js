import { TRANSLATION_LANGUAGES } from "./config.js";

export function generateManifest(lang = "pt-br") {
  const manifest = {
    id: "org.rdg.autotranslate",
    version: "2.0.0",
    name: "Auto Translate RDG",
    description: "Addon que traduz automaticamente legendas para o idioma selecionado via LibreTranslate API.",
    logo: "https://auto-translate-rdg.onrender.com/icon.png",
    background: "https://auto-translate-rdg.onrender.com/bg.jpg",
    contactEmail: "rdgaddons@outlook.com",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    },
    configuration: {
      defaultLanguage: lang,
      supportedLanguages: TRANSLATION_LANGUAGES.map(l => ({
        code: l.code,
        name: l.name
      }))
    }
  };
  return manifest;
}
