# gb-vosk-tts

Russian stress (ударение) improvements for the client-side [vosk-tts](https://github.com/alphacep/vosk-tts)
text-to-speech engine used on [gospod-bog.ru](https://gospod-bog.ru).

vosk-tts's own bundled dictionary leaves any word it doesn't know **completely
unstressed** — no fallback, no guessing. This repo layers extra, freely
licensed stress sources on top, checked before falling back to vosk-tts's
own dictionary:

1. **`data/custom-terms.json`** — site-specific vocabulary vosk-tts's model
   and general Russian dictionaries don't cover: theological terminology
   (диспенсационализм, ковенантное, законничество…) and proper names of
   historical Baptist/Reformed figures the site writes about. Built by
   scanning the site's actual article text (`tools/scan-site-vocabulary.js`)
   and verifying each candidate's stress against Wikipedia/Gramota.ru/etc.
   See `data/REVIEW-custom-terms.md` for a confidence-annotated list —
   review it before trusting low-confidence entries.
2. **[russian-stress-marker](https://github.com/zdarsch/russian-stress-marker)**
   (MIT) — a compact ~700KB finite-state automaton covering ~2 million
   accented Russian word forms. Ordinary vocabulary vosk-tts's own
   dictionary happens to miss.
3. Anything neither layer knows falls through to vosk-tts's own dictionary /
   G2P fallback, unchanged — this repo never makes stress worse, only fills
   gaps.

## Layout

```
src/
  vosk-tts-core.js     JS port of vosk-tts's Python text pipeline (g2p,
                        dictionary parsing, WordPiece tokenizer, phoneme
                        stream assembly, number-to-words). Differentially
                        tested against the real Python package.
  vosk-tts-engine.js    Browser wrapper: lazy-loads onnxruntime-web + the
                        vosk-tts ONNX model on first use, runs inference,
                        caches the model in IndexedDB.
  stress-lookup.js      The layered stress lookup described above.
data/
  custom-terms.json           site-specific dictionary (this repo's own MIT code)
  russian-stress-marker.bin   vendored MIT dictionary (see THIRD_PARTY_NOTICES.md)
  REVIEW-custom-terms.md      confidence notes on every custom-terms.json entry
tools/
  scan-site-vocabulary.js     finds words in a site's content that aren't
                              covered by russian-stress-marker (candidates
                              for custom-terms.json)
tests/
  *.test.mjs                  run with `node tests/<file>.test.mjs`
```

## Usage

This is consumed by [gb-is-my-strength](https://github.com/FedorMilovanov/gb-is-my-strength)'s
`js/vosk-tts-engine.js`, which calls `StressLookup.getPlusForm(word)` before
falling back to plain G2P for any word not in vosk-tts's own dictionary.

```js
const { StressLookup, StressMarkerDict } = require('./stress-lookup.js');
const lookup = new StressLookup({
  customTerms: new Map(Object.entries(require('../data/custom-terms.json'))),
  markerDictBuffer: /* ArrayBuffer of data/russian-stress-marker.bin */,
});
lookup.getPlusForm('диспенсационализм'); // -> "диспенсационал+изм"
lookup.getPlusForm('незнакомоеслово');   // -> null (fall back as before)
```

## License

This repo's own code and `data/custom-terms.json`: MIT (see `LICENSE`).
The vendored `data/russian-stress-marker.bin` and its decoder in
`stress-lookup.js` are also MIT — see `THIRD_PARTY_NOTICES.md` for the
exact provenance and why other candidate dictionaries (Silero Stress,
RUAccent, StressRNN's Zaliznyak-derived dictionary) were rejected on
licensing grounds.
