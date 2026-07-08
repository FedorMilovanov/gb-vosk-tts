/**
 * vosk-tts-engine.js
 * Браузерный движок озвучки на базе vosk-tts (github.com/alphacep/vosk-tts, Apache 2.0):
 * настоящая нейросеть (VITS + BERT-эмбеддинги для ударений), инференс через onnxruntime-web,
 * целиком в браузере, без сервера. Модель качается с Hugging Face один раз и кэшируется
 * в IndexedDB — при повторных визитах готова мгновенно.
 * (alphacephei.com — официальный хост той же модели — не отдаёт Access-Control-Allow-Origin,
 * поэтому cross-origin fetch() с этого сайта до него не доходит; huggingface.co подтверждённо
 * отдаёт "access-control-allow-origin: *" на этот файл, см. AuditRepo REPORT.md Round 3.)
 *
 * Ничего не подключается, пока страница явно не вызовет ensureLoaded()/speak() — используется
 * только floating-cluster-controller.js по клику «Слушать».
 *
 * API: window.VoskTTSEngine.{ isSupported, isReady, ensureLoaded, speak, cancel }
 */
(function () {
  'use strict';

  var CORE_SRC = '/js/vosk-tts-core.js';
  var STRESS_LOOKUP_SRC = '/js/vosk-stress-lookup.js';
  var CUSTOM_TERMS_URL = '/js/vosk-custom-terms.json';
  var STRESS_MARKER_URL = '/js/vosk-stress-marker.bin';
  var ORT_SRC = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js';
  var FFLATE_SRC = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js';
  // Quantized variant (782MB -> 280MB): BERT sub-model INT8 dynamic-quantized
  // (654MB -> 156.5MB, ONNX Runtime quantize_dynamic, verified byte-identical
  // *behavior* via real audio A/B before shipping — same site vocabulary,
  // same speaker); the main VITS sub-model's quantized output had a broken
  // MatMulInteger shape and was left at its original size. See AuditRepo
  // tts-quality-audit-2026-07-07/-08 for the generation + verification steps.
  var MODEL_URL = 'https://huggingface.co/CurtMil/gb-vosk-tts-model/resolve/main/model-quant.zip';
  // SHA-256 computed locally from the exact bytes uploaded, then
  // independently re-verified against the file the user actually has on
  // disk (Get-FileHash) before this URL went live — both matched exactly.
  // Update this whenever MODEL_URL points at different bytes, or every
  // fresh download will fail the check below.
  var EXPECTED_MODEL_SHA256 = '34e742ce9bb3c1ae86679d5974d2496b9fae50f0629f51bb4f5edfadc5ff3d71';
  var NEEDED = ['model.onnx', 'dictionary', 'config.json', 'bert/model.onnx', 'bert/vocab.txt'];
  var DB_NAME = 'gb-vosk-tts';
  var SAMPLE_RATE = 22050;

  var state = { loading: null, ready: false, config: null, dic: null, tok: null, sess: null, bertSess: null, stressLookup: null };
  var audioEl = null;

  function fetchStressLookup() {
    // Small same-origin assets (~700KB total) — no reason to gate the whole
    // engine on them; a failure here just means no extra stress coverage,
    // never breaks synthesis (vosk-tts's own dictionary/G2P still runs).
    return Promise.all([
      fetch(CUSTOM_TERMS_URL).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
      fetch(STRESS_MARKER_URL).then(function (r) { return r.ok ? r.arrayBuffer() : null; }).catch(function () { return null; })
    ]).then(function (results) {
      var customJson = results[0] || {};
      var markerBuf = results[1];
      delete customJson._comment;
      var customTerms = new Map(Object.entries(customJson));
      return new window.VoskStressLookup.StressLookup({ customTerms: customTerms, markerDictBuffer: markerBuf || undefined });
    }).catch(function (err) {
      console.warn('[vosk-tts] stress-lookup dictionaries unavailable, continuing without them:', err);
      return null;
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('script load failed: ' + src)); };
      document.head.appendChild(s);
    });
  }

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      var r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('files'); };
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }
  function idbGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction('files').objectStore('files').get(key);
        t.onsuccess = function () { resolve(t.result || null); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }
  function idbSet(key, val) {
    return idbOpen().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction('files', 'readwrite').objectStore('files').put(val, key);
        t.onsuccess = function () { resolve(); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  function extractZip(u8) {
    var unzipped = fflate.unzipSync(u8, {
      filter: function (f) {
        return NEEDED.some(function (n) { return f.name.endsWith('/' + n) || f.name === n; });
      }
    });
    // longest suffix wins first so "bert/model.onnx" can't be shadowed by "model.onnx"
    var byLen = NEEDED.slice().sort(function (a, b) { return b.length - a.length; });
    var files = {};
    Object.keys(unzipped).forEach(function (name) {
      for (var i = 0; i < byLen.length; i++) {
        var n = byLen[i];
        if (name.endsWith('/' + n) || name === n) { files[n] = unzipped[name]; break; }
      }
    });
    if (!files['model.onnx'] || !files['dictionary'] || !files['config.json']) {
      throw new Error('vosk model archive: model.onnx/dictionary/config.json not found');
    }
    return files;
  }

  function bufToHex(buf) {
    var bytes = new Uint8Array(buf), hex = '';
    for (var i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
    return hex;
  }

  // Verifies the raw downloaded zip against EXPECTED_MODEL_SHA256 before it's
  // trusted/unzipped/cached — the model is a 700+MB arbitrary binary fetched
  // from a third-party host (Hugging Face) with no other integrity signal in
  // this pipeline otherwise. Only runs on a fresh network download, not on
  // cache hits (already-cached bytes were verified the first time they were
  // stored). Skips (doesn't block playback) if SubtleCrypto is unavailable —
  // e.g. very old browsers or a non-HTTPS context — rather than breaking TTS
  // entirely over a missing nice-to-have safety check.
  function verifyModelIntegrity(buf) {
    if (!(window.crypto && window.crypto.subtle && window.crypto.subtle.digest)) return Promise.resolve();
    return window.crypto.subtle.digest('SHA-256', buf).then(function (hash) {
      var hex = bufToHex(hash);
      if (hex !== EXPECTED_MODEL_SHA256) {
        throw new Error('model integrity check failed: sha256 ' + hex.slice(0, 12) + '... != expected ' + EXPECTED_MODEL_SHA256.slice(0, 12) + '...');
      }
    });
  }

  // Cache key is MODEL_URL itself, not a fixed string — if the model file
  // this constant points to ever changes (e.g. a future quantized upload),
  // returning visitors automatically re-fetch instead of playing back a
  // stale/mismatched cached model from IndexedDB under the old URL's entry.
  function fetchModelFiles() {
    return idbGet(MODEL_URL).then(function (cached) {
      if (cached) return cached;
      return fetch(MODEL_URL).then(function (resp) {
        if (!resp.ok) throw new Error('model download HTTP ' + resp.status);
        return resp.arrayBuffer();
      }).then(function (buf) {
        return verifyModelIntegrity(buf).then(function () {
          var files = extractZip(new Uint8Array(buf));
          return idbSet(MODEL_URL, files).then(function () { return files; });
        });
      });
    });
  }

  function sliceBuf(u8) { return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength); }

  function ensureLoaded() {
    if (state.ready) return Promise.resolve();
    if (state.loading) return state.loading;
    state.loading = Promise.all([
      window.VoskTTSCore ? Promise.resolve() : loadScript(CORE_SRC),
      window.VoskStressLookup ? Promise.resolve() : loadScript(STRESS_LOOKUP_SRC),
      window.fflate ? Promise.resolve() : loadScript(FFLATE_SRC),
      window.ort ? Promise.resolve() : loadScript(ORT_SRC)
    ]).then(function () {
      // single-threaded WASM: no SharedArrayBuffer / COOP-COEP headers required
      ort.env.wasm.numThreads = 1;
      return Promise.all([fetchModelFiles(), fetchStressLookup()]);
    }).then(function (results) {
      var files = results[0];
      state.stressLookup = results[1];
      var td = new TextDecoder('utf-8');
      state.config = JSON.parse(td.decode(files['config.json']));
      state.dic = VoskTTSCore.parseDictionary(td.decode(files['dictionary']));
      var hasBert = files['bert/model.onnx'] && files['bert/vocab.txt'];
      return Promise.all([
        ort.InferenceSession.create(sliceBuf(files['model.onnx']), { executionProviders: ['wasm'] }),
        hasBert
          ? ort.InferenceSession.create(sliceBuf(files['bert/model.onnx']), { executionProviders: ['wasm'] })
          : Promise.resolve(null)
      ]).then(function (sessions) {
        state.sess = sessions[0];
        state.bertSess = sessions[1];
        if (state.bertSess) state.tok = new VoskTTSCore.WordPieceTokenizer(td.decode(files['bert/vocab.txt']));
        state.ready = true;
      });
    }).catch(function (err) {
      state.loading = null; // allow retry on the next play click
      throw err;
    });
    return state.loading;
  }

  function i64(arr, dims) { return new ort.Tensor('int64', BigInt64Array.from(arr, function (x) { return BigInt(x); }), dims); }
  function f32(arr, dims) { return new ort.Tensor('float32', Float32Array.from(arr), dims); }

  function bertRows(text, nopunc) {
    var enc = state.tok.encode(text);
    var n = enc.ids.length;
    var feeds = {
      input_ids: i64(enc.ids, [1, n]),
      attention_mask: i64(enc.attention_mask, [1, n]),
      token_type_ids: i64(enc.type_ids, [1, n])
    };
    var avail = state.bertSess.inputNames;
    Object.keys(feeds).forEach(function (k) { if (avail.indexOf(k) === -1) delete feeds[k]; });
    return state.bertSess.run(feeds).then(function (out) {
      var t = out[state.bertSess.outputNames[0]];
      var dims = t.dims.slice();
      if (dims.length === 3 && dims[0] === 1) dims = dims.slice(1);
      var hid = dims[1];
      var sel = VoskTTSCore.selectBertRows(enc.tokens, nopunc);
      var rows = [];
      for (var i = 0; i < sel.length; i++) {
        var start = sel[i] * hid;
        rows.push(t.data.subarray(start, start + hid));
      }
      return { rows: rows, hidden: hid };
    });
  }

  // Site-specific pre-normalization, run BEFORE VoskTTSCore.normalizeText()
  // (which strips all non-Cyrillic characters — Roman numerals and Latin
  // abbreviation letters must be converted to Cyrillic/digits here first,
  // or normalizeText silently deletes them). See AuditRepo
  // tts-quality-audit-2026-07-07 for the source of this list.

  // Bible-book abbreviations actually attested in this site's own content
  // (see e.g. the decorative Scripture background in js/enhancements.js) —
  // not a general-purpose Bible-abbreviation dictionary. Each spoken form
  // follows standard Russian citation convention (OT law/history books
  // nominative matching their title; prophets/Gospels genitive per "Книга
  // пророка .../Евангелие от ..."; epistles per their own preposition).
  // Extend this list as new abbreviations turn up in real articles.
  var SITE_ABBREVIATIONS = [
    ['1 Цар.', 'первая книга Царств'],   // multi-word / numbered forms first,
    ['1 Пет.', 'первое послание Петра'], // no shorter "Цар."/"Пет." entry to conflict with
    ['Быт.', 'Бытие'],
    ['Исх.', 'Исход'],
    ['Лев.', 'Левит'],
    ['Втор.', 'Второзаконие'],
    ['Суд.', 'Судей'],
    ['Пс.', 'Псалом'],
    ['Ис.', 'Исаии'],
    ['Иер.', 'Иеремии'],
    ['Иез.', 'Иезекииля'],
    ['Мал.', 'Малахии'],
    ['Лк.', 'Луки'],
    ['Ин.', 'Иоанна'],
    ['Рим.', 'Римлянам'],
    ['Откр.', 'Откровение'],
    // Safe, invariant (no grammatical-case dependency) abbreviations.
    // Both cases listed explicitly — plain split/join below is case-sensitive
    // (no regex flags needed), and these can legally start a sentence.
    ['т.е.', 'то есть'], ['Т.е.', 'То есть'],
    ['т.д.', 'так далее'], ['Т.д.', 'Так далее'],
    ['т.п.', 'тому подобное'], ['Т.п.', 'Тому подобное'],
    ['см.', 'смотри'], ['См.', 'Смотри']
  ];

  // Roman numerals ("XIX век") were previously silently deleted by
  // normalizeText's non-Cyrillic strip — the number vanished entirely,
  // leaving just "век". Converts to a plain Arabic-numeral CARDINAL
  // reading via the existing numberToWords pipeline: "XIX" -> "19" ->
  // "девятнадцать". This is *not* grammatically correct for a century
  // ("девятнадцатый век" — ordinal — would be correct); building a real
  // Russian ordinal generator with gender/case agreement was out of scope
  // for this pass. Still strictly better than the number disappearing.
  var ROMAN_ORDER = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
  var ROMAN_VALUES = { M: 1000, CM: 900, D: 500, CD: 400, C: 100, XC: 90, L: 50, XL: 40, X: 10, IX: 9, V: 5, IV: 4, I: 1 };
  function romanToArabic(s) {
    var i = 0, num = 0;
    while (i < s.length) {
      var matched = false;
      for (var j = 0; j < ROMAN_ORDER.length; j++) {
        var sym = ROMAN_ORDER[j];
        if (s.slice(i, i + sym.length) === sym) { num += ROMAN_VALUES[sym]; i += sym.length; matched = true; break; }
      }
      if (!matched) return null;
    }
    return num;
  }
  function arabicToRoman(n) {
    var out = '', rest = n;
    for (var j = 0; j < ROMAN_ORDER.length; j++) {
      var sym = ROMAN_ORDER[j];
      while (rest >= ROMAN_VALUES[sym]) { out += sym; rest -= ROMAN_VALUES[sym]; }
    }
    return out;
  }
  function expandRomanNumerals(text) {
    // Round-trip validation (arabicToRoman(n) === m) rejects malformed
    // sequences (e.g. "IIII", "VV") and most incidental all-caps Latin
    // words that happen to use only I/V/X/L/C/D/M — real prose essentially
    // never contains standalone valid-roman-numeral Latin tokens.
    return text.replace(/\b[IVXLCDM]{1,15}\b/g, function (m) {
      var n = romanToArabic(m);
      if (n === null || n <= 0 || n > 3999 || arabicToRoman(n) !== m) return m;
      return String(n);
    });
  }

  // Century references ("XIX век") are grammatically ORDINAL ("девятнадцатый
  // век"/nineteenth century), not cardinal — expandRomanNumerals() above
  // only produces a cardinal reading ("19 век"/"nineteen century"), audibly
  // wrong. This covers the one bounded, common pattern: a Roman numeral
  // immediately followed by "век" in one of its 5 singular case forms
  // (masculine adjective agreement — "века" is treated as singular
  // genitive, the far more common reading vs. a plural-range "XIX-XX века",
  // which this doesn't special-case and falls through to the cardinal
  // reading above instead — still an improvement over the number vanishing
  // entirely, just not grammatically perfect for that narrower case).
  var ORDINAL_UNITS = ['', 'первый', 'второй', 'третий', 'четвёртый', 'пятый', 'шестой', 'седьмой', 'восьмой', 'девятый'];
  var ORDINAL_TEENS = ['десятый', 'одиннадцатый', 'двенадцатый', 'тринадцатый', 'четырнадцатый', 'пятнадцатый', 'шестнадцатый', 'семнадцатый', 'восемнадцатый', 'девятнадцатый'];
  var ORDINAL_TENS = { 2: 'двадцатый', 3: 'тридцатый', 4: 'сороковой', 5: 'пятидесятый', 6: 'шестидесятый', 7: 'семидесятый', 8: 'восьмидесятый', 9: 'девяностый' };
  var CARDINAL_TENS = { 2: 'двадцать', 3: 'тридцать', 4: 'сорок', 5: 'пятьдесят', 6: 'шестьдесят', 7: 'семьдесят', 8: 'восемьдесят', 9: 'девяносто' };
  var VEK_CASE = { 'век': 'nom', 'века': 'gen', 'веку': 'dat', 'веком': 'instr', 'веке': 'prep' };
  function ordinalNominative(n) {
    if (n <= 0 || n > 99) return null;
    if (n < 10) return ORDINAL_UNITS[n];
    if (n < 20) return ORDINAL_TEENS[n - 10];
    var tens = Math.floor(n / 10), units = n % 10;
    if (units === 0) return ORDINAL_TENS[tens];
    return CARDINAL_TENS[tens] + ' ' + ORDINAL_UNITS[units];
  }
  // "третий" (3rd) is the one irregular masculine ordinal (soft possessive-
  // type declension); every other ordinal is a regular hard adjective —
  // strip its nominative -ый/-ой ending and append the target case's suffix.
  function declineOrdinal(phrase, caseCode) {
    if (caseCode === 'nom' || !caseCode) return phrase;
    var parts = phrase.split(' ');
    var last = parts[parts.length - 1];
    var declined;
    if (last === 'третий') {
      declined = { gen: 'третьего', dat: 'третьему', instr: 'третьим', prep: 'третьем' }[caseCode] || last;
    } else {
      declined = last.slice(0, -2) + ({ gen: 'ого', dat: 'ому', instr: 'ым', prep: 'ом' }[caseCode] || '');
    }
    parts[parts.length - 1] = declined;
    return parts.join(' ');
  }
  function expandCenturyOrdinals(text) {
    // [а-яё]* (not \w*) after "век" — JS regex \b/\w don't recognize
    // Cyrillic as "word" characters, so \b never fires at a Cyrillic
    // boundary and \w* never matches Cyrillic suffix letters at all.
    return text.replace(/\b([IVXLCDM]{1,7})(\s+)(век[а-яё]*)/g, function (whole, roman, sp, vekForm) {
      var n = romanToArabic(roman);
      if (n === null || n <= 0 || n > 99 || arabicToRoman(n) !== roman) return whole;
      var nomOrdinal = ordinalNominative(n);
      if (!nomOrdinal) return whole;
      var caseCode = VEK_CASE[vekForm.toLowerCase()] || 'nom';
      return declineOrdinal(nomOrdinal, caseCode) + sp + vekForm;
    });
  }

  function expandSiteAbbreviations(text) {
    var out = text;
    for (var i = 0; i < SITE_ABBREVIATIONS.length; i++) {
      out = out.split(SITE_ABBREVIATIONS[i][0]).join(SITE_ABBREVIATIONS[i][1]);
    }
    return expandRomanNumerals(expandCenturyOrdinals(out));
  }

  // Words vosk-tts's own dictionary doesn't know get NO stress at all
  // (its g2p fallback has no accent info to work with). Where our extra
  // dictionaries (site terminology + russian-stress-marker) DO know a word,
  // splice in vosk-tts's own "+letter" marker before the stressed vowel —
  // g2pConvert() already understands this convention for accented input.
  // Words vosk-tts's dictionary already covers are left untouched even if
  // our lookup also has an answer, since its own pronunciation should win.
  function injectCustomStress(text) {
    if (!state.stressLookup) return text;
    return text.replace(/[а-яё]+/gi, function (word) {
      var lower = word.toLowerCase();
      if (state.dic.has(lower)) return word;
      var plus = state.stressLookup.getPlusForm(lower);
      return plus || word;
    });
  }

  function synthChunk(chunk, rate, speakerId) {
    var cfg = state.config;
    var inf = cfg.inference || {};
    var noise = inf.noise_level !== undefined ? inf.noise_level : 0.8;
    var durNoise = inf.duration_noise_level !== undefined ? inf.duration_noise_level : 0.8;
    var scale = inf.scale !== undefined ? inf.scale : 1.0;
    var speechRate = rate * (inf.speech_rate !== undefined ? inf.speech_rate : 1.0);
    chunk = chunk.trim().replace(/—/g, '-');
    chunk = injectCustomStress(chunk);
    var mt = cfg.model_type || '';
    var knownMt = mt === 'multistream_v3' || mt === 'multistream_v2' || mt === 'multistream_v1';
    if (state.tok && !knownMt && !state._warnedUnknownModelType) {
      state._warnedUnknownModelType = true;
      console.warn('[vosk-tts] unrecognized config.model_type "' + mt + '" — BERT stress ' +
        'disambiguation is loaded but will be skipped for this model (falls back to plain g2p).');
    }

    function runSession(feeds) {
      var avail = state.sess.inputNames;
      Object.keys(feeds).forEach(function (k) { if (avail.indexOf(k) === -1) delete feeds[k]; });
      return state.sess.run(feeds).then(function (out) {
        return VoskTTSCore.floatToInt16(out[state.sess.outputNames[0]].data, scale);
      });
    }

    if (state.tok && (mt === 'multistream_v3' || mt === 'multistream_v2' || mt === 'multistream_v1')) {
      var v3 = mt === 'multistream_v3';
      var wordPos = mt !== 'multistream_v1';
      return bertRows(v3 ? chunk.toLowerCase().replace(/[+_]/g, '') : chunk.replace(/[+_]/g, ''), v3)
        .then(function (b) {
          var g = VoskTTSCore.g2pMultistream(chunk, cfg, state.dic, { wordPos: wordPos, scales: v3 });
          var T = g.streams.length;
          var flat = new Array(5 * T);
          for (var s = 0; s < 5; s++) for (var t2 = 0; t2 < T; t2++) flat[s * T + t2] = g.streams[t2][s];
          var hid = b.hidden;
          var bertFlat = new Float32Array(hid * T);
          for (var p = 0; p < T; p++) {
            var idx = Math.min(g.bertIndex[p], b.rows.length - 1);
            var row = b.rows[idx < 0 ? b.rows.length - 1 : idx];
            for (var h = 0; h < hid; h++) bertFlat[h * T + p] = row[h];
          }
          var feeds = {
            input: i64(flat, [1, 5, T]),
            input_lengths: i64([T], [1]),
            scales: f32([noise, 1.0 / speechRate, durNoise], [3]),
            sid: i64([speakerId], [1]),
            bert: new ort.Tensor('float32', bertFlat, [1, hid, T])
          };
          if (v3) feeds.phone_duration_extra = f32(g.durationExtra, [1, T]);
          return runSession(feeds);
        });
    }

    var ids = VoskTTSCore.g2pNoembed(chunk, cfg, state.dic);
    var T2 = ids.length;
    return runSession({
      input: i64(ids, [1, T2]),
      input_lengths: i64([T2], [1]),
      scales: f32([noise, 1.0 / speechRate, durNoise], [3]),
      sid: i64([speakerId], [1])
    });
  }

  var currentObjectUrl = null;

  function getAudioEl() {
    if (!audioEl) {
      audioEl = document.createElement('audio');
      audioEl.style.display = 'none';
      document.body.appendChild(audioEl);
    }
    return audioEl;
  }

  function setAudioSrc(a, blob) {
    // Each chunk creates a fresh Blob URL — without revoking the previous one,
    // a long article (many chunks) leaks a Blob for the rest of the page's life.
    if (currentObjectUrl) { try { URL.revokeObjectURL(currentObjectUrl); } catch (_) {} }
    currentObjectUrl = URL.createObjectURL(blob);
    a.src = currentObjectUrl;
  }

  function isSupported() {
    return !!(window.indexedDB && window.WebAssembly && window.fetch && window.TextDecoder);
  }
  function isReady() { return state.ready; }

  // rate: множитель скорости диктора (та же localStorage-скорость, что и у Web Speech);
  // задаётся нативно через scales модели — это звучит естественнее, чем ускорение готовой
  // записи через audio.playbackRate (не «съедает» фонемы на 2x).
  function speak(text, rate, speakerId, onend, onerror) {
    var handle = { engine: 'vosk', cancelled: false };
    var norm = VoskTTSCore.normalizeText(expandSiteAbbreviations(text));
    if (!norm) { setTimeout(function () { if (!handle.cancelled) onend(); }, 0); return handle; }
    synthChunk(norm, rate || 1, speakerId || 0).then(function (pcm) {
      if (handle.cancelled) return;
      var a = getAudioEl();
      var wav = VoskTTSCore.int16ToWav(pcm, SAMPLE_RATE);
      a.onended = function () { if (!handle.cancelled) onend(); };
      a.onerror = function (e) { if (!handle.cancelled) onerror(e); };
      setAudioSrc(a, new Blob([wav], { type: 'audio/wav' }));
      a.playbackRate = 1;
      var p = a.play();
      if (p && p.catch) p.catch(function (e) { if (!handle.cancelled) onerror(e); });
    }).catch(function (err) {
      if (!handle.cancelled) onerror(err);
    });
    return handle;
  }

  function cancel(handle) {
    if (handle) handle.cancelled = true;
    if (audioEl) {
      try { audioEl.pause(); audioEl.removeAttribute('src'); audioEl.load(); } catch (_) {}
    }
    if (currentObjectUrl) { try { URL.revokeObjectURL(currentObjectUrl); } catch (_) {} currentObjectUrl = null; }
  }

  window.VoskTTSEngine = {
    isSupported: isSupported,
    isReady: isReady,
    ensureLoaded: ensureLoaded,
    speak: speak,
    cancel: cancel
  };
})();
