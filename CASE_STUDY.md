# Case study: Russian stress correction for browser-based TTS

## Problem

The open-source `vosk-tts` text path cannot supply reliable stress marks for some words absent from its own dictionary. A theological and literary site contains uncommon terms and historical names; leaving them to a generic grapheme-to-phoneme fallback can result in unstressed or incorrectly stressed forms. The objective was to improve that **input layer**, not to invent a new text-to-speech engine.

## Approach

1. Inventory unusual Cyrillic words in the actual consuming site's article files using `tools/scan-site-vocabulary.js`.
2. Curate site-specific corrections in `data/custom-terms.json`; preserve confidence/provenance notes in `data/REVIEW-custom-terms.md`.
3. Add a compact second lookup layer from `zdarsch/russian-stress-marker` (MIT), retaining the exact third-party credit in `THIRD_PARTY_NOTICES.md`.
4. Return `null` when no supplementary stress is known; keep the base `vosk-tts` dictionary and G2P fallback rather than inventing a pronunciation.
5. Verify parser and conversion behavior with `tests/stress-lookup.test.mjs` and `tests/vosk-tts-core.test.mjs`, using `tests/ref.json` where applicable.

## Evidence and boundaries

- The vendored dictionary is approximately 722 KB and is described by its upstream as containing roughly two million Russian word forms. **That is upstream dictionary coverage, not a measured improvement in this site's pronunciation accuracy.**
- The JavaScript text pipeline is documented as a port evaluated against the real Python package; the original Python engine, inference runtime and speech model are third-party technology.
- This repository includes the source integration and tests, but does not independently prove how many words became correct in production, the live playback success rate, latency or any commercial outcome. Claims about those results require separately dated downstream evidence.
- The original project license and third-party notices are separate: [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Reproduce the code-level checks

```sh
node tests/stress-lookup.test.mjs
node tests/vosk-tts-core.test.mjs
```

Read [ARCHITECTURE.md](ARCHITECTURE.md) for component boundaries and [OWNER.md](OWNER.md) for attribution. This case illustrates the maintained boundary: **human-directed integration and verification of external technology, without claiming ownership of its model or dictionary**.
