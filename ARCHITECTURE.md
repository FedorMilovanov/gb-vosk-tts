# Architecture: browser TTS integration and stress lookup

This document describes the implementation in the repository, **not** independent ownership of the upstream speech model.

## Request path

```text
Host site (gb-is-my-strength): user requests playback
  |
  +-- src/vosk-tts-engine.js: lazy loading, model download/integrity check,
  |                           browser inference and IndexedDB cache
  |
  +-- src/stress-lookup.js: lookup for words missing in the base dictionary
  |      1. data/custom-terms.json (reviewed site-specific terms)
  |      2. data/russian-stress-marker.bin (third-party MIT dictionary)
  |      3. no match -> retain original upstream dictionary / G2P fallback
  |
  +-- src/vosk-tts-core.js: dictionary parsing, Russian G2P,
         tokenizer and phoneme/model-input preparation
  |
  +-- onnxruntime-web + externally downloaded Vosk ONNX model
         -> browser-generated speech audio
```

**Separation of concerns:** `src/vosk-tts-core.js` ports the text-processing behavior used by the external `vosk-tts` pipeline; it does not contain the ONNX runtime or model weights. `src/vosk-tts-engine.js` supplies the browser orchestration and checks the pinned model download. `src/stress-lookup.js` exposes a layered lookup with a null result when there is no extra stress information.

## Inputs and provenance

- `data/custom-terms.json`: site-specific terminology; review confidence and locators before editing using `data/REVIEW-custom-terms.md`.
- `data/russian-stress-marker.bin`: vendored ~722 KB third-party dictionary, **not** an original data set. See `THIRD_PARTY_NOTICES.md`.
- The upstream speech model is fetched over the network. The pinned model URL and its expected SHA-256 live in `src/vosk-tts-engine.js`; changing one without verifying the other is unsafe.
- The consuming site's script paths and Content Security Policy are integration responsibilities of [gb-is-my-strength](https://github.com/FedorMilovanov/gb-is-my-strength), not a guarantee from these source files.

## Verification

From the repository root with Node.js available:

```sh
node tests/stress-lookup.test.mjs
node tests/vosk-tts-core.test.mjs
```

`tests/ref.json` contains reference fixtures. The tests check the text-processing and stress-lookup layers; they **do not, by themselves, certify current live-site playback, latency, voice naturalness, browser download reliability or content rights**. Those require browser and downstream-production evidence.

## Change boundaries

Do not remove the fallback when a supplemental dictionary cannot load; do not bypass model checksum verification, loosen host CSP as a substitute for finding the actual external origins, or change the third-party data or license claims without a provenance review. See [SECURITY.md](SECURITY.md) and [OWNER.md](OWNER.md).
