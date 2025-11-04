export const LIBRETRANSLATE_API =
  process.env.LIBRETRANSLATE_API || "https://libretranslate.com";

export const PORT = process.env.PORT || 10000;

// idiomas disponíveis para tradução
export const TRANSLATION_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "zh", name: "Chinese" },
  { code: "hi", name: "Hindi" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "ar", name: "Arabic" },
  { code: "bn", name: "Bengali" },
  { code: "ru", name: "Russian" },
  { code: "pt", name: "Português (Portugal)" },
  { code: "pt-br", name: "Português (Brasil)" },
  { code: "id", name: "Indonesian" },
  { code: "de", name: "German" },
  { code: "ja", name: "Japanese" },
  { code: "pa", name: "Punjabi" },
  { code: "jv", name: "Javanese" },
  { code: "ko", name: "Korean" },
  { code: "tr", name: "Turkish" },
  { code: "vi", name: "Vietnamese" },
  { code: "it", name: "Italian" },
  { code: "ta", name: "Tamil" },
  { code: "ur", name: "Urdu" }
];
