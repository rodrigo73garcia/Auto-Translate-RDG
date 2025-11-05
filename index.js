// ROTA CURTA + LONGA para legendas (aceita /subtitles/movie/0816692.json
// e /subtitles/movie/tt0816692/filename=...&videoSize=...&videoHash=....json)
app.get("/subtitles/:type/:imdbParam(*)", async (req, res) => {
  try {
    console.log(">>> GET", req.originalUrl, req.query);

    const { type } = req.params;
    let raw = req.params.imdbParam || ""; // pega todo o resto do caminho

    // Tentativa 1: procurar o primeiro ttXXXXXXXX ou somente dígitos
    const m = raw.match(/(tt\d+)|(\d{5,})/);
    if (!m) {
      console.warn("❌ IMDB ID não encontrado no path:", raw);
      return res.status(404).json({ error: "imdb id not found" });
    }

    // extrair e normalizar: remover 'tt' se existir e manter leading zeros
    let imdbId = (m[0].startsWith("tt") ? m[0].slice(2) : m[0]).replace(/^0+/, (s) => s); 
    // OBS: mantive a string tal como está (algumas versões usam zeros à esquerda). Se preferir manter zeros:
    imdbId = m[0].startsWith("tt") ? m[0].slice(2) : m[0];

    // Normalizar linguagem: Accepta os valores que o Stremio envia (ex: "Português (Brasil)" ou "pt-br")
    let lang = req.query.lang || req.query.language || "pt-br";
    // Mapeamento simples (expanda conforme seu config)
    const langMap = {
      "pt-br": "pt-br",
      "pt-BR": "pt-br",
      "Português (Brasil)": "pt-br",
      "Português": "pt-br",
      "pt": "pt",
      "en": "en",
      "es": "es"
    };
    const targetLang = langMap[lang] || langMap[lang.toLowerCase()] || "pt-br";

    console.log(`🎬 SUBTITLES REQUEST -> type: ${type} | imdb: ${imdbId} | lang: ${targetLang}`);

    // Chama sua função existente (fetchAndTranslateSubtitle)
    const subtitleResult = await fetchAndTranslateSubtitle(imdbId.replace(/^tt/, ""), targetLang);

    // O formato da resposta precisa seguir o que o Stremio espera.
    // Se sua fetchAndTranslateSubtitle já retorna o JSON pronto (com url etc.), retorne-o.
    // Caso contrário, retorne no formato abaixo (exemplo):
    if (!subtitleResult) {
      return res.status(404).json({ subtitles: [] });
    }

    // Exemplo: se subtitleResult for um array de objetos prontos para stremio:
    if (Array.isArray(subtitleResult)) {
      return res.json({ subtitles: subtitleResult });
    }

    // Se subtitleResult for o SRT traduzido em texto, crie um objeto que a UI do Stremio possa usar:
    // Nesse caso você precisa servir o SRT traduzido por uma URL pública (p.ex. /public/generated/...), 
    // mas como muitas implementações fornecem a legenda diretamente como url do SRT reverso,
    // vou retornar um objeto inline de exemplo com url apontando para a rota que entrega o .srt:
    // (Ajuste conforme sua arquitetura: se você já gera e armazena o srt, coloque a URL real.)
    const subtitleObject = {
      id: `autotranslate-${imdbId}-${targetLang}`,
      lang: targetLang,
      name: `Auto Translate RDG (${targetLang})`,
      // Se você possuir uma rota que entrega o SRT cru, use aqui a URL real:
      // ex: `${req.protocol}://${req.get('host')}/generated/${imdbId}-${targetLang}.srt`
      url: `${req.protocol}://${req.get("host")}${req.path}.srt?lang=${encodeURIComponent(targetLang)}`,
      hearing_impaired: false
    };

    return res.json({ subtitles: [subtitleObject] });
  } catch (err) {
    console.error("❌ Erro na rota subtitles:", err);
    return res.status(500).json({ error: err.message });
  }
});
