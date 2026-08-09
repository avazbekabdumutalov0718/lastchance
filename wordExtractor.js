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

// Bir qatordan "so'z <ajratuvchi> ma'no" juftligini topish
function parseLine(line) {
  const clean = line.trim();
  if (!clean || clean.length > 160) return null;

  const delimiters = [' — ', ' – ', ' - ', '\t', ' = ', ':', '—', '–'];
  for (const d of delimiters) {
    const idx = clean.indexOf(d);
    if (idx > 0 && idx < clean.length - d.length) {
      let word = clean.slice(0, idx).trim().replace(/^[\d.)\-\s]+/, '');
      let meaning = clean.slice(idx + d.length).trim();
      
      // Bo'sh hamda 'undefined' qiymatlarni rad etamiz
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

  for (const line of lines) {
    const p = parseLine(line);
    if (p) pairs.push(p);
  }

  // Agar oddiy qatorlarda ajralmasa, sarlavha-ma'no strukturasi bo'yicha qaraymiz
  if (pairs.length === 0) {
    const headingRe = /^([A-Za-z0-9'’\-\s]{2,60})\s*$/;
    const meaningRe = /^(?:definition|meaning|tarjima|ma'no|ma'nosi|definition:)\s*:?\s*(.+)$/i;
    const fieldLabelRe = /^(definition|meaning|tarjima|ma'no|ma'nosi|example|notes?)$/i;

    let currentWord = null;
    let currentMeaning = null;

    const flush = () => {
      if (
        currentWord && 
        currentMeaning && 
        currentWord !== 'undefined' && 
        currentMeaning !== 'undefined'
      ) {
        pairs.push({ word: currentWord, meaning: currentMeaning });
      }
      currentWord = null;
      currentMeaning = null;
    };

    for (const line of lines) {
      if (!line) continue;
      const headingMatch = line.match(headingRe);
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
  } catch (err) {
    console.error(`extractWordPairs xatosi [${filePath}]:`, err);
  }
  return [];
}

module.exports = { extractWordPairs, extractPairsFromText, parseLine };
