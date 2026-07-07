/**
 * vosk-tts-engine.js
 * Браузерный движок озвучки на базе vosk-tts (github.com/alphacep/vosk-tts, Apache 2.0):
 * настоящая нейросеть (VITS + BERT-эмбеддинги для ударений), инференс через onnxruntime-web,
 * целиком в браузере, без сервера. Модель качается с alphacephei.com один раз и кэшируется
 * в IndexedDB — при повторных визитах готова мгновенно.
 *
 * Ничего не подключается, пока страница явно не вызовет ensureLoaded()/speak() — используется
 * только floating-cluster-controller.js по клику «Слушать».
 *
 * API: window.VoskTTSEngine.{ isSupported, isReady, ensureLoaded, speak, cancel }
 */
(function () {
  'use strict';

  var CORE_SRC = '/js/vosk-tts-core.js';
  var ORT_SRC = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js';
  var FFLATE_SRC = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js';
  var MODEL_URL = 'https://alphacephei.com/vosk/models/vosk-model-tts-ru-0.9-multi.zip';
  var NEEDED = ['model.onnx', 'dictionary', 'config.json', 'bert/model.onnx', 'bert/vocab.txt'];
  var DB_NAME = 'gb-vosk-tts';
  var SAMPLE_RATE = 22050;

  var state = { loading: null, ready: false, config: null, dic: null, tok: null, sess: null, bertSess: null };
  var audioEl = null;

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

  function fetchModelFiles() {
    return idbGet('files').then(function (cached) {
      if (cached) return cached;
      return fetch(MODEL_URL).then(function (resp) {
        if (!resp.ok) throw new Error('model download HTTP ' + resp.status);
        return resp.arrayBuffer();
      }).then(function (buf) {
        var files = extractZip(new Uint8Array(buf));
        return idbSet('files', files).then(function () { return files; });
      });
    });
  }

  function sliceBuf(u8) { return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength); }

  function ensureLoaded() {
    if (state.ready) return Promise.resolve();
    if (state.loading) return state.loading;
    state.loading = Promise.all([
      window.VoskTTSCore ? Promise.resolve() : loadScript(CORE_SRC),
      window.fflate ? Promise.resolve() : loadScript(FFLATE_SRC),
      window.ort ? Promise.resolve() : loadScript(ORT_SRC)
    ]).then(function () {
      // single-threaded WASM: no SharedArrayBuffer / COOP-COEP headers required
      ort.env.wasm.numThreads = 1;
      return fetchModelFiles();
    }).then(function (files) {
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

  function synthChunk(chunk, rate, speakerId) {
    var cfg = state.config;
    var inf = cfg.inference || {};
    var noise = inf.noise_level !== undefined ? inf.noise_level : 0.8;
    var durNoise = inf.duration_noise_level !== undefined ? inf.duration_noise_level : 0.8;
    var scale = inf.scale !== undefined ? inf.scale : 1.0;
    var speechRate = rate * (inf.speech_rate !== undefined ? inf.speech_rate : 1.0);
    chunk = chunk.trim().replace(/—/g, '-');
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
    var norm = VoskTTSCore.normalizeText(text);
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
