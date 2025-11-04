const langSelect = document.getElementById("langSelect");
const generateBtn = document.getElementById("generate");
const output = document.getElementById("output");
const installUrlInput = document.getElementById("installUrl");
const copyBtn = document.getElementById("copyBtn");
const installBtn = document.getElementById("installBtn");

// idiomas disponíveis
const languages = [
  "English", "Chinese", "Hindi", "Spanish", "French", "Arabic", "Bengali",
  "Russian", "Português (Portugal)", "Português (Brasil)", "Indonesian",
  "German", "Japanese", "Punjabi", "Javanese", "Korean", "Turkish",
  "Vietnamese", "Italian", "Tamil", "Urdu"
];

languages.forEach(l => {
  const opt = document.createElement("option");
  opt.value = l;
  opt.textContent = l;
  langSelect.appendChild(opt);
});

generateBtn.onclick = () => {
  const lang = langSelect.value;
  const url = `${window.location.origin}/manifest.json?lang=${encodeURIComponent(lang)}`;
  installUrlInput.value = url;
  installBtn.href = `stremio://${url}`;
  output.classList.remove("hidden");
};

copyBtn.onclick = () => {
  installUrlInput.select();
  document.execCommand("copy");
  alert("Link copiado!");
};
