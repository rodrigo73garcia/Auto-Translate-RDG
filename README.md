# 🎬 Auto Translate RDG (LibreTranslate Edition)

**Auto Translate RDG** é uma extensão para **Stremio** que busca automaticamente legendas em inglês (ou outro idioma disponível) a partir de fontes externas como:
- [OpenSubtitles Stremio](https://opensubtitles.strem.io)
- [Legendas.tv Stremio](https://legendas.tv.strem.io)

Em seguida, ela traduz as legendas usando **[LibreTranslate](https://libretranslate.com/)**, um serviço **open source e 100% gratuito**, sem necessidade de API Key.

---

## 🚀 Recursos

✅ Tradução automática de legendas para até **21 idiomas**, incluindo:
- Português (Brasil)
- Português (Portugal)
- Inglês
- Espanhol
- Francês
- Alemão
- Italiano
- Russo
- Chinês (Simplificado)
- Japonês
- Coreano
- Árabe
- Hindi
- Turco
- Holandês
- Polonês
- Sueco
- Tailandês
- Indonésio
- Vietnamita
- Hebraico

✅ Fontes de legenda já configuradas:
```
https://opensubtitles.strem.io, https://legendas.tv.strem.io
```

✅ Página de configuração traduzida automaticamente para o idioma do navegador do usuário.

✅ Deploy 100% gratuito no [Render](https://render.com).

---

## ⚙️ Instalação

1. Acesse:
   ```
   https://auto-translate-rdg.onrender.com/configure
   ```
2. Escolha o idioma de destino.
3. Gere o link de instalação.
4. Adicione o link ao Stremio.

---

## 💻 Variáveis de ambiente (Render)

| Variável | Exemplo | Descrição |
|-----------|----------|------------|
| `PUBLIC_BASE_URL` | `https://auto-translate-rdg.onrender.com` | URL pública do deploy |
| `STREMIO_SUBS_BASES` | `https://opensubtitles.strem.io,https://legendas.tv.strem.io` | Fontes de legendas padrão |
| `LIBRETRANSLATE_API` | `https://libretranslate.com` | Endpoint do serviço LibreTranslate |

---

## 📦 Deploy no Render

1. Crie um novo **Web Service** no [Render](https://render.com).
2. Conecte este repositório.
3. Configure as variáveis de ambiente acima.
4. Deploy automático! 🎉

---

## 🧠 Como funciona

Quando você reproduz um filme ou série no Stremio:
1. A extensão busca legendas nos servidores configurados (`OpenSubtitles`, `Legendas.tv`).
2. Se encontrar uma legenda em inglês, traduz usando o **LibreTranslate**.
3. Caso não haja versão em inglês, traduz qualquer idioma disponível.
4. Retorna automaticamente a legenda traduzida para o player.

---

## 🛠️ Créditos

Desenvolvido por **Rodrigo Garcia**, com integração à API **LibreTranslate** e compatibilidade com o ecossistema Stremio.

---

## 📜 Licença

MIT — Uso livre e aberto.  
