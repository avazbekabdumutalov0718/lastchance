const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

// Bir qatordan "so'z <ajratuvchi> ma'no" juftligini topishga harakat qiladi
function parseLine(line) {
  const clean = line.trim();
  if (!clean || clean.length > 160) return null;

  const delimiters = [' — ', ' – ', ' - ', '\t', ' = ', ':', '—', '–'];
  for (const d of delimiters) {
    const idx = clean.indexOf(d);
    if (idx > 0 && idx < clean.length - d.length) {
      const word = clean.slice(0, idx).trim().replace(/^[\d.)\-\s]+/, '');
      const meaning = clean.slice(idx + d.length).trim();
      if (word && meaning && word.length <= 60 && meaning.length <= 200) {
        return { word, meaning };
      }
    }
  }
  // Ikki yoki undan ko'p bo'sh joy bilan ajratilgan holatlar (jadval ko'rinishidagi matn)
  const spaceSplit = clean.split(/\s{2,}/);
  if (spaceSplit.length >= 2) {
    const word = spaceSplit[0].trim().replace(/^[\d.)\-\s]+/, '');
    const meaning = spaceSplit.slice(1).join(' ').trim();
    if (word && meaning && word.length <= 60 && meaning.length <= 200) {
      return { word, meaning };
    }
  }
  return null;
}

function extractPairsFromText(text) {
  // Avval "raqam. So'z" + "Ma'nosi: ..." tuzilishini aniqlashga harakat qilamiz
  // (masalan: "19. Testament" ... "Ma'nosi: Bir narsaning dalili")
  const structured = extractStructuredPairs(text);
  if (structured.length >= 2) return structured;

  // Aks holda oddiy "so'z - ma'no" qatorlarini qidiramiz
  const lines = text.split('\n');
  const pairs = [];
  for (const line of lines) {
    const pair = parseLine(line);
    if (pair) pairs.push(pair);
  }
  return dedupe(pairs);
}

function dedupe(pairs) {
  const seen = new Set();
  return pairs.filter((p) => {
    const key = p.word.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// "19. Testament" kabi raqamlangan sarlavhalarni va ular ostidagi "Ma'nosi: ..." qatorini topadi.
// Maydon nomlari (Aytilishi, Sinonimlar, Ibora va h.k.) so'z sifatida OLINMAYDI.
function extractStructuredPairs(text) {
  const lines = text.split('\n').map((l) => l.trim());
  const headingRe = /^\d+[.)]\s*([A-Za-zʻʼ''`0-9\-\s]{2,60})$/;
  const meaningRe = /^Ma['ʼʻ`]?nosi\s*[:\-]\s*(.+)$/i;
  const fieldLabelRe = /^(Aytilishi|Ma['ʼʻ`]?nosi|Sinonimlar|Ibora( ma['ʼʻ`]?nosi)?|Misol)\b/i;

  const pairs = [];
  let currentWord = null;
  let currentMeaning = null;

  const flush = () => {
    if (currentWord && currentMeaning) pairs.push({ word: currentWord, meaning: currentMeaning });
    currentWord = null;
    currentMeaning = null;
  };

  for (const line of lines) {
    if (!line) continue;
    const headingMatch = line.match(headingRe);
    // Sarlavha bo'lishi uchun maydon nomlaridan biri bo'lmasligi kerak
    if (headingMatch && !fieldLabelRe.test(headingMatch[1].trim())) {
      flush();
      currentWord = headingMatch[1].trim();
      continue;
    }
    const meaningMatch = line.match(meaningRe);
    if (meaningMatch && currentWord && !currentMeaning) {
      currentMeaning = meaningMatch[1].trim();
    }
  }
  flush();
  return dedupe(pairs);
}

// filePath, fileType ('pdf' | 'html' | 'image') -> Promise<[{word, meaning}]>
async function extractWordPairs(filePath, fileType) {
  try {
    if (fileType === 'html') {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const text = stripHtml(raw);
      return extractPairsFromText(text);
    } else if (fileType === 'pdf') {
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);
      return extractPairsFromText(data.text || '');
    } else if (fileType === 'image') {
      const { data } = await Tesseract.recognize(filePath, 'eng+uzb', { logger: () => {} });
      return extractPairsFromText(data.text || '');
    }
  } catch (e) {
    console.error('So\'z ajratishda xatolik:', e.message);
  }
  return [];
}

module.exports = { extractWordPairs };
