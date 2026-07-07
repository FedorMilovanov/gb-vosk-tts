/**
 * stress-lookup.js
 *
 * Layered Russian word-stress lookup, used to inject vosk-tts's own
 * "+letter" stress markup (e.g. "маш+ина") into words vosk-tts's bundled
 * model dictionary doesn't know, before they reach vosk-tts-core.js's
 * G2P fallback (which otherwise leaves such words completely unstressed).
 *
 * Layers, checked in order (first match wins):
 *   1. Custom site terminology  (data/custom-terms.json)      — highest priority
 *   2. russian-stress-marker    (data/russian-stress-marker.bin, MIT)
 *   (a Wiktionary/kaikki.org layer can be added the same way later)
 *
 * russian-stress-marker's dictionary is a compact minimal acyclic FSA
 * (MIT, https://github.com/zdarsch/russian-stress-marker) recognizing
 * ~2 million already-accented lowercase Russian word forms. Each edge is
 * a 32-bit int: byte 31-24 = a "label" byte (either a plain letter or one
 * of ~18 special accented-vowel codes), bits 1-0 = flags (bit1 = last
 * edge in this node, bit0 = this transition completes an accepted word),
 * bits 23-2 = target node index. This file ports that decoder (originally
 * content.js in the same repo, also MIT) and converts its output
 * (accent mark placed AFTER the vowel, via ' for primary / ` for
 * secondary stress) into vosk-tts's convention (a bare "+" placed BEFORE
 * the vowel, primary stress only — secondary/grave marks are dropped,
 * matching what vosk-tts's own dictionaries encode).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StressLookup = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ============ russian-stress-marker FSA decoder ============ */

  // Maps a plain Cyrillic codepoint (У+0410-042F, У+0430-044F, Ё/ё) to the
  // encoding byte used inside the FSA (same table as upstream content.js).
  var PLAIN_BYTE = (function () {
    var m = new Map();
    m.set(1025, 168); // Ё
    m.set(1105, 184); // ё
    for (var i = 1040; i < 1104; i++) m.set(i, i - 848);
    return m;
  }());

  // Maps an FSA edge label byte to the "base" (unaccented) byte it matches
  // against input text — accented-vowel bytes map to their plain letter.
  var BASE_BYTE = (function () {
    var m = new Map();
    for (var i = 0; i < 256; i++) m.set(i, i);
    var accented = {
      129: 224, 131: 229, 140: 232, 144: 224, 154: 229, 156: 238,
      157: 232, 158: 238, 159: 243, 161: 243, 165: 251, 178: 251,
      179: 253, 184: 229, 186: 254, 188: 253, 189: 254, 190: 255, 191: 255
    };
    Object.keys(accented).forEach(function (k) { m.set(+k, accented[+k]); });
    return m;
  }());

  // Maps an FSA edge label byte to the OUTPUT string for that position:
  // plain letters map to themselves, accented codes map to "letter+mark"
  // (acute ' = primary stress, grave ` = secondary stress).
  var OUTPUT_STR = (function () {
    var m = new Map();
    m.set(184, String.fromCharCode(1105)); // ё (no stress mark needed, ё is always stressed)
    for (var i = 224; i < 256; i++) m.set(i, String.fromCharCode(i + 848));
    var marks = {
      129: 'а`', 131: 'е`', 140: 'и`', 144: "а'", 154: "е'", 156: 'о`',
      157: "и'", 158: "о'", 159: "у'", 161: 'у`', 165: 'ы`', 178: "ы'",
      179: "э'", 186: "ю'", 188: 'э`', 189: 'ю`', 190: 'я`', 191: "я'"
    };
    Object.keys(marks).forEach(function (k) { m.set(+k, marks[+k]); });
    return m;
  }());

  function StressMarkerDict(buf) {
    this.fsa = new Uint32Array(buf);
  }

  StressMarkerDict.prototype._nodeEdges = function (j) {
    var edges = [];
    var fsa = this.fsa;
    while (j < fsa.length) {
      edges.push(fsa[j]);
      if (fsa[j] & 2) break;
      j++;
    }
    return edges;
  };

  // Returns the FIRST fully-accented match for a lowercase word, or null.
  // (russian-stress-marker's own content_script also takes the first/only
  // match — homographs are deliberately left unstressed upstream.)
  StressMarkerDict.prototype.lookup = function (word) {
    var self = this;
    var result = null;
    var candidate = [];

    function dfs(j, i) {
      if (result) return; // first match wins
      var edges = self._nodeEdges(j);
      for (var r = 0; r < edges.length && !result; r++) {
        var edge = edges[r];
        var label = edge >>> 24;
        var k = (edge & 0xffffff) >>> 2;
        if (i >= word.length) continue;
        var wantByte = PLAIN_BYTE.get(word.charCodeAt(i));
        if (wantByte === undefined || BASE_BYTE.get(label) !== wantByte) continue;
        candidate[i] = OUTPUT_STR.get(label);
        if (i === word.length - 1 && (edge & 1)) {
          result = candidate.slice(0, word.length).join('');
        } else if (k < self.fsa.length) {
          dfs(k, i + 1);
        }
      }
    }

    dfs(0, 0);
    return result;
  };

  // "маши'на" / "маш`ина" -> "маш+ина" (vosk-tts convention: '+' before the
  // stressed vowel, primary stress only — drop secondary/grave marks).
  function toVoskPlus(accented) {
    return accented.replace(/([аеиоуыэюя])`/gi, '$1').replace(/([аеиоуыэюя])'/gi, '+$1');
  }

  /* ============ layered lookup ============ */

  function StressLookup(opts) {
    opts = opts || {};
    this.customTerms = opts.customTerms || null; // Map<string,string> word -> "+"-marked spelling
    this.markerDict = opts.markerDictBuffer ? new StressMarkerDict(opts.markerDictBuffer) : null;
  }

  // Returns a "+"-marked spelling of `word` (lowercase, no punctuation) if
  // any layer knows it, otherwise null (caller should fall back to
  // vosk-tts's own dictionary / unstressed G2P, unchanged).
  StressLookup.prototype.getPlusForm = function (word) {
    var w = word.toLowerCase();
    if (this.customTerms && this.customTerms.has(w)) return this.customTerms.get(w);
    if (this.markerDict) {
      var hit = this.markerDict.lookup(w);
      if (hit) return toVoskPlus(hit);
    }
    return null;
  };

  return {
    StressMarkerDict: StressMarkerDict,
    StressLookup: StressLookup,
    toVoskPlus: toVoskPlus
  };
}));
