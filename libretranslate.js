import axios from "axios";

export async function translateText(text, targetLang) {
  try {
    // Converter código de idioma para o esperado pela API My Memory
    const langCode = targetLang === "pt-br" ? "pt-BR" : targetLang.toUpperCase();
    
    console.log(`🌐 Traduzindo para: ${langCode}`);
    
    // Dividir em pedaços se muito grande (máximo 500 caracteres por requisição)
    const chunks = splitTextIntoChunks(text, 500);
    console.log(`📦 Dividido em ${chunks.length} pedaços`);
    
    let translatedChunks = [];
    
    for (let i = 0; i < chunks.length; i++) {
      try {
        // Usar My Memory Translate (gratuito, sem limite)
        const response = await axios.get('https://api.mymemory.translated.net/get', {
          params: {
            q: chunks[i],
            langpair: `en|${langCode}`
          },
          timeout: 10000
        });
        
        if (response.data.responseStatus === 200) {
          const translatedText = response.data.responseData.translatedText;
          translatedChunks.push(translatedText);
          console.log(`✅ Pedaço ${i + 1}/${chunks.length} traduzido`);
        } else {
          console.warn(`⚠️ Pedaço ${i + 1} falhou, usando original`);
          translatedChunks.push(chunks[i]);
        }
      } catch (err) {
        console.error(`❌ Erro ao traduzir pedaço ${i + 1}:`, err.message);
        translatedChunks.push(chunks[i]); // fallback
      }
      
      // Aguardar 100ms entre requisições para evitar rate limit
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return translatedChunks.join('\n');
    
  } catch (err) {
    console.error("❌ Erro geral na tradução:", err.message);
    return text;
  }
}

// Dividir texto em chunks menores
function splitTextIntoChunks(text, maxChunkSize) {
  const lines = text.split('\n');
  const chunks = [];
  let currentChunk = '';
  
  for (let line of lines) {
    const lineLength = line.length;
    
    // Se a linha sozinha é maior que o limite, pula
    if (lineLength > maxChunkSize) {
      if (currentChunk) chunks.push(currentChunk.trim());
      chunks.push(line); // envia mesmo assim
      currentChunk = '';
      continue;
    }
    
    // Se adicionar a linha excede o limite, salva chunk atual
    if ((currentChunk + line).length > maxChunkSize) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = line;
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line;
    }
  }
  
  if (currentChunk.trim()) chunks.push(currentChunk.trim());
  
  return chunks.length > 0 ? chunks : [text];
}
