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

// Bir qatordan "so'z - ma'no" ni ajratish
function parseLine(line) {
  const clean = line.trim();
  if (!clean || clean.length > 160) return null;

  const delimiters = [' — ', ' – ', ' - ', '\t', ' = ', ':', '—', '–'];
  for (const d of delimiters) {
    const idx = clean.indexOf(d);
    if (idx > 0 && idx < clean.length - d.length) {
      let word = clean.slice(0, idx).trim().replace(/^[\d.)\-\s•]+/, '');
      let meaning = clean.slice(idx + d.length).trim();
      
      if (word && meaning && word !== 'undefined' && meaning !== 'undefined') {
        return { word, meaning };
      }
    }
  }
  return null;
}

function extractPairsFromText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const pairs = [];

  // 1-USUL: Bitta qatordagi so'z va ma'nolar (masalan: "Base - Asoslamoq")
  for (const line of lines) {
    const p = parseLine(line);
    if (p) pairs.push(p);
  }

  // 2-USUL: Ko'p qatorli format (Siz yuklagan PDF fayldagidek formatlar uchun)
  if (pairs.length === 0) {
    let currentWord = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // So'z sarlavhasini aniqlash (Masalan: "1. Base", "2. Placement", "Base")
      const wordMatch = line.match(/^(?:\d+[\.\)]\s*)?([A-Za-z0-9'’\-\s]{2,50})$/);
      if (wordMatch) {
        const potentialWord = wordMatch[1].trim();
        if (!/^(Ma'nosi|Aytilishi|Sinonimlar|Ibora|Misol|PAGE)/i.test(potentialWord)) {
          currentWord = potentialWord;
        }
      }

      // Ma'nosini aniqlash (Masalan: "Ma'nosi: Asoslamoq, tayanmoq")
      const meaningMatch = line.match(/^(?:•\s*)?Ma'nosi\s*:\s*(.+)$/i);
      if (meaningMatch && currentWord) {
        const meaning = meaningMatch[1].trim();
        if (currentWord && meaning && currentWord !== 'undefined' && meaning !== 'undefined') {
          pairs.push({ word: currentWord, meaning: meaning });
        }
        currentWord = null;
      }
    }
  }

  return dedupe(pairs);
}

function dedupe(pairs) {
  const seen = new Set();
  return pairs.filter((p) => {
    if (!p || !p.word || !p.meaning) return false;
    if (p.word === 'undefined' || p.meaning === 'undefined') return false;

    const key = `${p.word.toLowerCase()}:::${p.meaning.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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
  } catch (err) {
    console.error(`extractWordPairs xatosi [${filePath}]:`, err);
  }
  return [];
}

module.exports = { extractWordPairs, extractPairsFromText, parseLine };
