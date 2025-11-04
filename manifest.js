import { TRANSLATION_LANGUAGES } from "./config.js";

export function generateManifest(lang = "pt-br") {
  // Mapear idiomas corretamente
  const langMap = {
    "pt-br": "pt-BR",
    "Português (Brasil)": "pt-BR",
    "pt-BR": "pt-BR",
    "en": "en",
    "es": "es",
    "fr": "fr"
  };

  const targetLang = langMap[lang] || "pt-BR";

  const manifest = {
    id: "org.rdg.autotranslate",
    version: "2.0.0",
    name: "Auto Translate RDG",
    description: "Traduz legendas automaticamente",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: []
  };

  return manifest;
}
