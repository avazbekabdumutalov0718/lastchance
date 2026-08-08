const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

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
  const lines = text.split('\n');
  const pairs = [];
  for (const line of lines) {
    const pair = parseLine(line);
    if (pair) pairs.push(pair);
  }
  // Dublikatlarni olib tashlash
  const seen = new Set();
  return pairs.filter((p) => {
    const key = p.word.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// filePath, fileType ('pdf' | 'html') -> Promise<[{word, meaning}]>
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
    }
  } catch (e) {
    console.error('So\'z ajratishda xatolik:', e.message);
  }
  return [];
}

module.exports = { extractWordPairs };
