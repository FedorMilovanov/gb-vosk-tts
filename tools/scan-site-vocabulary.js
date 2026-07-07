#!/usr/bin/env node
/**
 * scan-site-vocabulary.js
 *
 * Walks the gb-is-my-strength content (MDX articles + Astro *Body/*Main
 * components + legacy static HTML), extracts every distinct Cyrillic word,
 * and reports which ones russian-stress-marker's 2M-word-form dictionary
 * does NOT know — i.e. candidates for our own custom-terms.json layer
 * (theological terminology, proper names, etc.).
 *
 * Filters out noise that isn't a real coverage gap:
 *  - monosyllabic words (1 vowel) — no stress ambiguity to resolve
 *  - low-frequency (<2 occurrences) — likely OCR noise / one-off typos
 * and separately flags words that appeared capitalized in the source
 * (likely proper names) vs. lowercase-only (likely real vocabulary gaps).
 *
 * Usage: node tools/scan-site-vocabulary.js /path/to/gb-is-my-strength
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { StressMarkerDict } = require('../src/stress-lookup.js');

const SITE_ROOT = process.argv[2];
if (!SITE_ROOT) { console.error('usage: node scan-site-vocabulary.js <site-root>'); process.exit(1); }

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', 'coverage', 'reports',
  'audit', '_build-tools', 'scripts', 'docs', 'migration', 'research',
  '.astro', 'data', 'fonts', 'images', 'icons', 'css'
]);
const INCLUDE_EXT = new Set(['.mdx', '.md', '.astro', '.html']);

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out);
    } else if (INCLUDE_EXT.has(path.extname(e.name))) {
      out.push(full);
    }
  }
  return out;
}

function stripMarkup(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/---\n[\s\S]*?\n---/, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{[^{}]*\}/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ');
}

const VOWELS = /[аеёиоуыэюя]/gi;
function syllables(w) { return (w.match(VOWELS) || []).length; }

const files = walk(SITE_ROOT, []);
const freq = new Map();       // lowercase word -> count
const everCapitalized = new Set(); // lowercase word -> was seen Capitalized in source
const wordRe = /[А-Яа-яЁё]{3,}/g;

for (const f of files) {
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
  text = stripMarkup(text);
  const matches = text.match(wordRe) || [];
  for (const raw of matches) {
    const w = raw.toLowerCase();
    freq.set(w, (freq.get(w) || 0) + 1);
    if (/^[А-ЯЁ]/.test(raw)) everCapitalized.add(w);
  }
}

console.error(`Scanned ${files.length} files, ${freq.size} distinct words.`);

const buf = fs.readFileSync(path.join(__dirname, '../data/russian-stress-marker.bin'));
const dict = new StressMarkerDict(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

const names = [];
const vocab = [];
for (const [w, count] of freq) {
  if (syllables(w) < 2) continue;   // no stress ambiguity possible
  if (count < 2) continue;          // one-off / likely noise
  if (dict.lookup(w)) continue;     // already covered
  (everCapitalized.has(w) ? names : vocab).push([w, count]);
}
names.sort((a, b) => b[1] - a[1]);
vocab.sort((a, b) => b[1] - a[1]);

console.error(`${names.length} likely proper names, ${vocab.length} likely real vocabulary gaps.`);
console.log('=== LIKELY PROPER NAMES (capitalized in source) ===');
for (const [w, count] of names) console.log(`${count}\t${w}`);
console.log('\n=== LIKELY VOCABULARY GAPS (lowercase-only) ===');
for (const [w, count] of vocab) console.log(`${count}\t${w}`);
