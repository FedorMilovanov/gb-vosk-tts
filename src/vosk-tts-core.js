/* vosk-tts-core.js — JS port of alphacep/vosk-tts Python pipeline (g2p.py + synth.py text side).
   Faithful to master @ 2026-07: dictionary lookup → rule G2P fallback → multistream phoneme
   streams + BERT word embeddings. ONNX inference itself lives in the host page; this module
   only prepares model inputs and decodes nothing.
   Works both in Node (for tests) and as a browser <script>. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VoskTTSCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ============ g2p.py ============ */
  var SOFTLETTERS = new Set('яёюиье');
  var STARTSYL = new Set('#ъьаяоёуюэеиы-');
  var OTHERS = new Set(['#', '+', '-', 'ь', 'ъ']);
  var SOFTHARD = { 'б':'b','в':'v','г':'g','Г':'g','д':'d','з':'z','к':'k','л':'l','м':'m','н':'n','п':'p','р':'r','с':'s','т':'t','ф':'f','х':'h' };
  var OTHER_CONS = { 'ж':'zh','ц':'c','ч':'ch','ш':'sh','щ':'sch','й':'j' };
  var VOWELS = { 'а':'a','я':'a','у':'u','ю':'u','о':'o','ё':'o','э':'e','е':'e','и':'i','ы':'y' };

  function g2pConvert(stressword) {
    var chars = '#' + stressword + '#';
    // assign stress marks: '+' marks the NEXT char as stressed
    var sp = [];
    var stress = 0;
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      if (ch === '+') { stress = 1; }
      else { sp.push([ch, stress]); stress = 0; }
    }
    // pallatize (in place, excluding last element, like phones[:-1])
    for (var j = 0; j < sp.length - 1; j++) {
      var c = sp[j][0];
      if (SOFTHARD[c] !== undefined) {
        sp[j] = [SOFTHARD[c] + (SOFTLETTERS.has(sp[j + 1][0]) ? 'j' : ''), 0];
      }
      if (OTHER_CONS[sp[j][0]] !== undefined) {
        sp[j] = [OTHER_CONS[sp[j][0]], 0];
      }
    }
    // convert vowels
    var out = [];
    var prev = '';
    for (var k = 0; k < sp.length; k++) {
      var p = sp[k][0], st = sp[k][1];
      if (STARTSYL.has(prev) && 'яюеё'.indexOf(p) !== -1) out.push('j');
      if (VOWELS[p] !== undefined) out.push(VOWELS[p] + String(st));
      else out.push(p);
      prev = p;
    }
    return out.filter(function (x) { return !OTHERS.has(x); }).join(' ');
  }

  /* ============ dictionary (model.py) ============ */
  // "word prob phones..." per line; keep highest-prob entry per word.
  function parseDictionary(text) {
    var dic = new Map();
    var probs = new Map();
    var start = 0;
    var n = text.length;
    while (start < n) {
      var end = text.indexOf('\n', start);
      if (end === -1) end = n;
      var line = text.slice(start, end);
      start = end + 1;
      if (!line) continue;
      var s1 = line.indexOf(' ');
      if (s1 === -1) continue;
      var s2 = line.indexOf(' ', s1 + 1);
      if (s2 === -1) continue;
      var word = line.slice(0, s1);
      var prob = parseFloat(line.slice(s1 + 1, s2));
      var phones = line.slice(s2 + 1).replace(/[\r\n]+$/, '');
      if ((probs.get(word) || 0) < prob) {
        dic.set(word, phones);
        probs.set(word, prob);
      }
    }
    return dic;
  }

  /* ============ BertWordPieceTokenizer (lowercase, strip accents, [UNK]) ============ */
  function isPunctChar(ch) {
    var cp = ch.codePointAt(0);
    if ((cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) ||
        (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)) return true;
    return /\p{P}/u.test(ch);
  }

  function bertNormalize(text) {
    // BertNormalizer: clean control chars, lowercase, strip accents (NFD → drop Mn)
    var cleaned = '';
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      var cp = ch.charCodeAt(0);
      if (cp === 0 || cp === 0xFFFD) continue;
      if (ch === '\t' || ch === '\n' || ch === '\r') { cleaned += ' '; continue; }
      cleaned += ch;
    }
    cleaned = cleaned.toLowerCase();
    cleaned = cleaned.normalize('NFD').replace(/\p{Mn}/gu, '');
    return cleaned;
  }

  function basicTokenize(text) {
    var norm = bertNormalize(text);
    var tokens = [];
    var cur = '';
    for (var i = 0; i < norm.length; i++) {
      var ch = norm[i];
      if (/\s/.test(ch)) { if (cur) { tokens.push(cur); cur = ''; } continue; }
      if (isPunctChar(ch)) { if (cur) { tokens.push(cur); cur = ''; } tokens.push(ch); continue; }
      cur += ch;
    }
    if (cur) tokens.push(cur);
    return tokens;
  }

  function WordPieceTokenizer(vocabText) {
    this.vocab = new Map();
    var lines = vocabText.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var tok = lines[i].replace(/[\r\n]+$/, '');
      if (tok.length || i < lines.length - 1) this.vocab.set(tok, i);
    }
    this.unkId = this.vocab.get('[UNK]');
    this.clsId = this.vocab.get('[CLS]');
    this.sepId = this.vocab.get('[SEP]');
  }
  WordPieceTokenizer.prototype.encode = function (text) {
    var words = basicTokenize(text);
    var tokens = ['[CLS]'];
    var ids = [this.clsId];
    for (var w = 0; w < words.length; w++) {
      var word = words[w];
      if (word.length > 100) { tokens.push('[UNK]'); ids.push(this.unkId); continue; }
      var subTokens = [];
      var isBad = false;
      var startPos = 0;
      while (startPos < word.length) {
        var endPos = word.length;
        var curSub = null;
        while (startPos < endPos) {
          var substr = (startPos > 0 ? '##' : '') + word.slice(startPos, endPos);
          if (this.vocab.has(substr)) { curSub = substr; break; }
          endPos -= 1;
        }
        if (curSub === null) { isBad = true; break; }
        subTokens.push(curSub);
        startPos = endPos;
      }
      if (isBad) { tokens.push('[UNK]'); ids.push(this.unkId); }
      else {
        for (var s = 0; s < subTokens.length; s++) {
          tokens.push(subTokens[s]);
          ids.push(this.vocab.get(subTokens[s]));
        }
      }
    }
    tokens.push('[SEP]');
    ids.push(this.sepId);
    return { tokens: tokens, ids: ids,
             attention_mask: ids.map(function () { return 1; }),
             type_ids: ids.map(function () { return 0; }) };
  };

  /* ============ text normalization (JS addition; Python expects clean text) ============ */
  var UNITS = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  var UNITS_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  var TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  var TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  var HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

  function tripletToWords(nnn, feminine) {
    var out = [];
    var h = Math.floor(nnn / 100), rest = nnn % 100;
    if (h) out.push(HUNDREDS[h]);
    if (rest >= 10 && rest <= 19) out.push(TEENS[rest - 10]);
    else {
      var t = Math.floor(rest / 10), u = rest % 10;
      if (t) out.push(TENS[t]);
      if (u) out.push((feminine ? UNITS_F : UNITS)[u]);
    }
    return out;
  }
  function pluralForm(n, forms) { // forms: [один, два-четыре, пять+]
    var n10 = n % 10, n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return forms[0];
    if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return forms[1];
    return forms[2];
  }
  function numberToWords(numStr) {
    var num = parseInt(numStr, 10);
    if (isNaN(num)) return '';
    if (num === 0) return 'ноль';
    if (num >= 1e12) return numStr.split('').map(function (d) { return UNITS[+d] || 'ноль'; }).join(' ');
    var groups = [ // [divisor, feminine, forms]
      [1e9, false, ['миллиард', 'миллиарда', 'миллиардов']],
      [1e6, false, ['миллион', 'миллиона', 'миллионов']],
      [1e3, true, ['тысяча', 'тысячи', 'тысяч']],
    ];
    var out = [];
    var rest = num;
    for (var g = 0; g < groups.length; g++) {
      var q = Math.floor(rest / groups[g][0]);
      rest = rest % groups[g][0];
      if (q) {
        // "тысяча девятьсот..." reads more naturally than "одна тысяча..." for years
        if (!(q === 1 && groups[g][0] === 1e3)) out = out.concat(tripletToWords(q, groups[g][1]));
        out.push(pluralForm(q, groups[g][2]));
      }
    }
    if (rest) out = out.concat(tripletToWords(rest, false));
    return out.join(' ');
  }

  function normalizeText(text) {
    var t = String(text);
    t = t.replace(/[«»„“”"]/g, ' ');       // quotes confuse stream alignment; drop
    t = t.replace(/[()\[\]{}]/g, ', ');     // parens not in vosk punct model → soften to pause
    t = t.replace(/[—–]/g, '-');
    t = t.replace(/…/g, '...');
    t = t.replace(/№/g, 'номер ');
    t = t.replace(/(\d)[.,](\d)/g, '$1 и $2'); // decimals: "3,5" -> "3 и 5" (rough)
    t = t.replace(/\d+/g, function (m) { return ' ' + numberToWords(m) + ' '; });
    // drop words containing no Cyrillic at all (latin/tech tokens the model can't say)
    t = t.split(/(\s+)/).map(function (w) {
      if (/^\s+$/.test(w) || w === '') return w;
      var core = w.replace(/[,.?!;:\-"]/g, '');
      if (core === '') return w;                 // pure punctuation — keep
      if (!/[а-яё]/i.test(core)) return w.replace(/[^,.?!;:\-]/g, ''); // keep trailing punct only
      return w;
    }).join('');
    t = t.replace(/[^а-яёА-ЯЁ ,.?!;:\-]/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    return t;
  }

  /* ============ synth.py text side ============ */
  function addPos(x) {
    if (x.length === 1) return [x[0] + '_S'];
    return x.map(function (p, i) {
      if (i === 0) return p + '_B';
      if (i === x.length - 1) return p + '_E';
      return p + '_I';
    });
  }

  function wordToPhones(word, dic) {
    if (dic.has(word)) return dic.get(word).split(/\s+/);
    return g2pConvert(word).split(/\s+/).filter(Boolean);
  }

  // Python: re.split("(\.\.\.|- |[ ,.?!;:\"()_])", text) with capturing group.
  function splitKeep(text, re) {
    var out = [];
    var last = 0;
    var m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      out.push(text.slice(last, m.index));
      out.push(m[0]);
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    out.push(text.slice(last));
    return out;
  }

  // Deliberate divergence from upstream vosk-tts: the reference Python only
  // splits "- " (hyphen+space), so a mid-word hyphen ("по-моему", "кто-то")
  // stays glued into one g2p "word" while BertWordPieceTokenizer splits it
  // into 2-3 tokens regardless — desyncing bertWordIndex from the BERT row
  // list for every word after the first hyphen in a sentence (verified
  // against the real vosk_tts.synth.Synth.g2p_multistream_scales — this bug
  // exists upstream too, not just in this port). Matching a bare `-` here
  // keeps word counts aligned with the tokenizer; the hyphen itself already
  // falls into the explicit `word === '-'` branch below, unaffected.
  var MS_PATTERN = /(\.\.\.|- |-|[ ,.?!;:"()_])/g;
  function isMsPunct(word) {
    return word === '...' || word === '- ' || /^[ ,.?!;:"()_]$/.test(word);
  }

  // g2p_multistream_scales / g2p_multistream unified.
  // Returns { streams: [ [phId, curPuncId, inQuote, lastPuncId, lastSentPuncId], ...],
  //           bertIndex: per-phoneme word index into selected-BERT rows,
  //           durationExtra: per-phoneme float }
  function g2pMultistream(text, config, dic, opts) {
    var wordPos = opts.wordPos, scales = opts.scales;
    var map = config.phoneme_id_map;
    var mapGet = function (p) {
      if (Object.prototype.hasOwnProperty.call(map, p)) return map[p];
      return map['_'] !== undefined ? map['_'] : 0;
    };
    text = text.replace(/ -/g, '- ');
    var phonemes = [['^', [], 0, 0]];
    var inQuote = 0;
    var curPunc = [];
    var bertWordIndex = 1;
    var parts = splitKeep(text.toLowerCase(), MS_PATTERN);
    for (var i = 0; i < parts.length; i++) {
      var word = parts[i];
      if (word === '') continue;
      if (word === '"') { inQuote = inQuote === 1 ? 0 : 1; continue; }
      if (word === '- ' || word === '-') { curPunc.push('-'); continue; }
      if (isMsPunct(word) && word !== ' ') { curPunc.push(word); continue; }
      if (word === ' ') {
        phonemes.push([' ', curPunc, inQuote, bertWordIndex]);
        curPunc = [];
        continue;
      }
      var wp = wordToPhones(word, dic);
      if (wordPos) wp = addPos(wp);
      for (var j = 0; j < wp.length; j++) phonemes.push([wp[j], [], inQuote, bertWordIndex]);
      curPunc = [];
      bertWordIndex += 1;
    }
    phonemes.push([' ', curPunc, inQuote, bertWordIndex]);
    phonemes.push(['$', [], 0, bertWordIndex]);

    var lastPunc = ' ';
    var lastSentPunc = ' ';
    var streams = [];
    var bertIndex = [];
    var durationExtra = [];
    for (var k = phonemes.length - 1; k >= 0; k--) {
      var p = phonemes[k];
      if (p[1].indexOf('...') !== -1) lastSentPunc = '...';
      else if (p[1].indexOf('.') !== -1) lastSentPunc = '.';
      else if (p[1].indexOf('!') !== -1) lastSentPunc = '!';
      else if (p[1].indexOf('?') !== -1) lastSentPunc = '?';
      else if (p[1].indexOf('-') !== -1) lastSentPunc = '-';
      var durExt = (scales && p[1].indexOf('_') !== -1) ? 20.0 : 0.0;
      var cp = p[1].length > 0 ? p[1][0] : '_';
      if (p[1].length > 0) lastPunc = p[1][0];
      streams.push([mapGet(p[0]), mapGet(cp), p[2], mapGet(lastPunc), mapGet(lastSentPunc)]);
      bertIndex.push(p[3]);
      if (scales) durationExtra.push(durExt);
    }
    streams.reverse(); bertIndex.reverse(); durationExtra.reverse();
    return { streams: streams, bertIndex: bertIndex, durationExtra: durationExtra };
  }

  // plain no-bert path (g2p_noembed): blank-interspersed single stream
  function g2pNoembed(text, config, dic) {
    var map = config.phoneme_id_map;
    var mapGet = function (p) {
      if (Object.prototype.hasOwnProperty.call(map, p)) return map[p];
      return map['_'] !== undefined ? map['_'] : 0;
    };
    var phonemes = ['^'];
    var parts = splitKeep(text.toLowerCase(), /([,.?!;:"() ])/g);
    for (var i = 0; i < parts.length; i++) {
      var word = parts[i];
      if (word === '') continue;
      if (/^[,.?!;:"() ]$/.test(word) || word === '-') phonemes.push(word);
      else {
        var wp = wordToPhones(word, dic);
        for (var j = 0; j < wp.length; j++) phonemes.push(wp[j]);
      }
    }
    phonemes.push('$');
    var ids = [];
    var first = mapGet(phonemes[0]);
    if (Array.isArray(first)) {
      ids = ids.concat(first);
      for (var k = 1; k < phonemes.length; k++) { ids.push(0); ids = ids.concat(mapGet(phonemes[k])); }
    } else {
      ids.push(first);
      for (var k2 = 1; k2 < phonemes.length; k2++) { ids.push(0); ids.push(mapGet(phonemes[k2])); }
    }
    return ids;
  }

  // BERT row selection (get_word_bert): rows for tokens not starting with '#',
  // and (nopunc) not matching [-,.?!;:"]
  function selectBertRows(tokens, nopunc) {
    var sel = [];
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t[0] === '#') continue;
      if (nopunc && /^[-,.?!;:"]/.test(t)) continue;
      sel.push(i);
    }
    return sel;
  }

  /* ============ WAV encode ============ */
  function floatToInt16(f32, scale) {
    var out = new Int16Array(f32.length);
    var s = (scale === undefined ? 1.0 : scale) * 32767.0;
    for (var i = 0; i < f32.length; i++) {
      var v = f32[i] * s;
      if (v > 32767) v = 32767;
      if (v < -32767) v = -32767;
      out[i] = v | 0;
    }
    return out;
  }
  function int16ToWav(pcm, sampleRate) {
    var buf = new ArrayBuffer(44 + pcm.length * 2);
    var dv = new DataView(buf);
    function ws(off, s) { for (var i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i)); }
    ws(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); ws(8, 'WAVE');
    ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, sampleRate, true); dv.setUint32(28, sampleRate * 2, true);
    dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    ws(36, 'data'); dv.setUint32(40, pcm.length * 2, true);
    new Int16Array(buf, 44).set(pcm);
    return buf;
  }

  /* ============ sentence chunking ============ */
  function splitSentences(text, maxLen) {
    maxLen = maxLen || 400;
    var parts = text.split(/([.!?]+\s+)/);
    var chunks = [];
    var buf = '';
    for (var i = 0; i < parts.length; i++) {
      buf += parts[i];
      if (buf.length >= maxLen && i % 2 === 1) {
        var tr = buf.trim();
        if (tr) chunks.push(tr);
        buf = '';
      }
    }
    var last = buf.trim();
    if (last) chunks.push(last);
    if (!chunks.length && text.trim()) chunks.push(text.trim());
    return chunks;
  }

  return {
    g2pConvert: g2pConvert,
    parseDictionary: parseDictionary,
    WordPieceTokenizer: WordPieceTokenizer,
    bertNormalize: bertNormalize,
    basicTokenize: basicTokenize,
    normalizeText: normalizeText,
    numberToWords: numberToWords,
    addPos: addPos,
    g2pMultistream: g2pMultistream,
    g2pNoembed: g2pNoembed,
    selectBertRows: selectBertRows,
    floatToInt16: floatToInt16,
    int16ToWav: int16ToWav,
    splitSentences: splitSentences,
  };
}));
