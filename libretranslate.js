import axios from "axios";

export async function translateText(text, targetLang) {
  try {
    // Converter código de idioma para o esperado pela API My Memory
    const langCode = targetLang === "pt-br" ? "pt-BR" : targetLang.toUpperCase();
    
    console.log(`🌐 Traduzindo para: ${langCode}`);
    
    // Aumentar tamanho dos chunks para fazer menos requisições (1500 caracteres em vez de 500)
    const chunks = splitTextIntoChunks(text, 1500);
    console.log(`📦 Dividido em ${chunks.length} pedaços`);
    
    let translatedChunks = [];
    
    for (let i = 0; i < chunks.length; i++) {
      let translated = false;
      let retries = 0;
      const maxRetries = 3;
      
      while (!translated && retries < maxRetries) {
        try {
          // Usar My Memory Translate (gratuito)
          const response = await axios.get('https://api.mymemory.translated.net/get', {
            params: {
              q: chunks[i],
              langpair: `en|${langCode}`
            },
            timeout: 15000
          });
          
          if (response.data.responseStatus === 200) {
            const translatedText = response.data.responseData.translatedText;
            translatedChunks.push(translatedText);
            console.log(`✅ Pedaço ${i + 1}/${chunks.length} traduzido`);
            translated = true;
          } else {
            console.warn(`⚠️ Pedaço ${i + 1} falhou (status: ${response.data.responseStatus}), usando original`);
            translatedChunks.push(chunks[i]);
            translated = true;
          }
        } catch (err) {
          retries++;
          
          if (err.response?.status === 429) {
            // Rate limit - aguardar mais
            const waitTime = Math.pow(2, retries) * 1000; // 2s, 4s, 8s
            console.warn(`⏱️ Rate limit no pedaço ${i + 1}, aguardando ${waitTime}ms antes de tentar novamente...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          } else {
            console.error(`❌ Erro ao traduzir pedaço ${i + 1} (tentativa ${retries}/${maxRetries}):`, err.message);
            
            if (retries >= maxRetries) {
              // Após 3 tentativas, usa o original
              translatedChunks.push(chunks[i]);
              translated = true;
            } else {
              // Aguardar antes de tentar novamente
              const waitTime = Math.pow(2, retries) * 500; // 500ms, 1s, 2s
              await new Promise(resolve => setTimeout(resolve, waitTime));
            }
          }
        }
      }
      
      // Aguardar 500ms entre requisições bem-sucedidas para evitar rate limit
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
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
    
    // Se a linha sozinha é maior que o limite, envia mesmo assim
    if (lineLength > maxChunkSize) {
      if (currentChunk) chunks.push(currentChunk.trim());
      chunks.push(line);
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
