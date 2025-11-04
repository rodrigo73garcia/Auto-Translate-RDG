# 🎬 Auto Translate RDG (LibreTranslate Edition)

**Auto Translate RDG** is a **Stremio subtitle add-on** that automatically fetches English subtitles (or any available language) from external sources such as:
- [OpenSubtitles Stremio](https://opensubtitles.strem.io)
- [Legendas.tv Stremio](https://legendas.tv.strem.io)

Then, it automatically translates them using **[LibreTranslate](https://libretranslate.com/)** — a **100% free and open-source** translation service, with **no API key required**.

---

## 🚀 Features

✅ Automatically translates subtitles into **21 languages**, including:
- Portuguese (Brazil)
- Portuguese (Portugal)
- English
- Spanish
- French
- German
- Italian
- Russian
- Chinese (Simplified)
- Japanese
- Korean
- Arabic
- Hindi
- Turkish
- Dutch
- Polish
- Swedish
- Thai
- Indonesian
- Vietnamese
- Hebrew

✅ Preconfigured subtitle sources:
```
https://opensubtitles.strem.io, https://legendas.tv.strem.io
```

✅ Configuration page automatically adapts to the user’s browser language.

✅ 100% free deploy via [Render](https://render.com).

---

## ⚙️ Installation

1. Visit:
   ```
   https://auto-translate-rdg.onrender.com/configure
   ```
2. Choose your target language.
3. Generate your installation link.
4. Add it to Stremio.

---

## 💻 Environment Variables (Render)

| Variable | Example | Description |
|-----------|----------|-------------|
| `PUBLIC_BASE_URL` | `https://auto-translate-rdg.onrender.com` | Public base URL of your deploy |
| `STREMIO_SUBS_BASES` | `https://opensubtitles.strem.io,https://legendas.tv.strem.io` | Default subtitle sources |
| `LIBRETRANSLATE_API` | `https://libretranslate.com` | LibreTranslate API endpoint |

---

## 📦 Deploy on Render

1. Create a new **Web Service** on [Render](https://render.com).
2. Connect this repository.
3. Add the environment variables listed above.
4. Deploy automatically! 🎉

---

## 🧠 How It Works

When you play a movie or series in Stremio:
1. The add-on searches for subtitles on the configured servers (`OpenSubtitles`, `Legendas.tv`).
2. If English subtitles are available, it translates them using **LibreTranslate**.
3. If not, it automatically translates subtitles from any available language.
4. The translated subtitle is then displayed in the player.

---

## 🛠️ Credits

Developed by **Rodrigo Garcia**, featuring full integration with the **LibreTranslate API** and compatibility with the Stremio ecosystem.

---

## 📜 License

MIT — Free and open to use.
