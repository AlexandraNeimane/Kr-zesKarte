// Prohibited-word filter. Word lists live in data/profanity/*.txt:
//   en.txt, ru.txt — LDNOOBW "List of Dirty, Naughty, Obscene and Otherwise Bad Words"
//                    https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words (CC BY 4.0)
//   lv.txt         — Latvian list maintained in this project (lines ending in * are stems).
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'profanity');

// Lowercase and strip diacritics so "sūds" and "suds" match the same entry.
function normalize(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const exact = new Set();   // single words matched exactly
const stems = [];          // prefixes (lv entries ending with *)
const phrases = [];        // multi-word entries matched as substrings
const files = [];

for (const file of fs.readdirSync(DIR).filter(f => f.endsWith('.txt'))) {
  files.push(file);
  for (let line of fs.readFileSync(path.join(DIR, file), 'utf8').split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    const w = normalize(line);
    if (w.endsWith('*')) stems.push(w.slice(0, -1));
    else if (/\s/.test(w)) phrases.push(w);
    else exact.add(w);
  }
}

// Returns the list of offending words found in text (empty array = clean).
function check(text) {
  const norm = normalize(text || '');
  const found = new Set();
  for (const orig of (text || '').split(/[^\p{L}\p{N}]+/u)) {
    const word = normalize(orig);
    if (!word) continue;
    if (exact.has(word) || stems.some(s => word.startsWith(s))) found.add(orig);
  }
  const padded = ' ' + norm.replace(/[^\p{L}\p{N}]+/gu, ' ') + ' ';
  for (const p of phrases) if (padded.includes(' ' + p + ' ')) found.add(p);
  return [...found];
}

module.exports = { check, stats: () => ({ files, words: exact.size + stems.length + phrases.length }) };
