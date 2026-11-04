# Third-party notices and modification record

This repository integrates third-party technologies. An implementation in a
different programming language is **not by itself proof of independent origin**.
See [LICENSING.md](LICENSING.md) for the per-file license map.

## Vosk TTS — Apache-2.0

- Original project: [alphacep/vosk-tts](https://github.com/alphacep/vosk-tts).
- License: **Apache License 2.0**; full upstream text:
  [THIRD_PARTY_LICENSES/vosk-tts-APACHE-2.0.txt](THIRD_PARTY_LICENSES/vosk-tts-APACHE-2.0.txt).
- Original text-processing implementation: `vosk_tts/g2p.py`,
  `vosk_tts/model.py` and `vosk_tts/synth.py`.
- Affected file: `src/vosk-tts-core.js`.
- **Modification notice:** in 2026, the Python-side phoneme rules,
  dictionary selection and phoneme stream preparation were adapted for
  JavaScript/Node/browser use. This file adds browser-facing tokenization,
  number normalization, input shape handling and documented behavior changes,
  including handling mid-word hyphens to avoid BERT row misalignment.

The upstream rules, mapping tables and overall processing sequence remain
recognizable in the port. We therefore treat this file under **Apache-2.0**
rather than claiming that a language translation makes it entirely
independent. We do not claim authorship of the upstream engine or model.

The separate `src/vosk-tts-engine.js` is a browser orchestration/inference
wrapper (lazy loading, integrity validation, IndexedDB and playback). It does
not transfer ownership of the Vosk model, nor replace the port's Apache license.

## russian-stress-marker — MIT

- Original project: [zdarsch/russian-stress-marker](https://github.com/zdarsch/russian-stress-marker).
- Original license: **MIT**, Copyright (c) 2024 zdarsch.
- Full upstream MIT notice:
  [THIRD_PARTY_LICENSES/russian-stress-marker-MIT.txt](THIRD_PARTY_LICENSES/russian-stress-marker-MIT.txt).
- Original sources: `ru_stress_marker/content.js` and its dictionary.
- Affected files: `data/russian-stress-marker.bin` (vendored dictionary)
  and `src/stress-lookup.js` (decoder adapted from upstream mappings and FSA
  traversal logic).
- **Modification notice:** the decoder was reorganized as a JS module,
  layered with reviewed local terms, and adjusted to emit Vosk's
  `+`-before-vowel stress notation. It is not an independently invented FSA
  dictionary or decoder.

The dictionary is vendored unchanged; its approximately two-million-form
coverage is **upstream data coverage**, not a measured live-site TTS quality
gain. Original copyright and the full MIT notice are preserved.

## Third-party ONNX model and browser inference dependencies

The `vosk-model-tts-ru-0.9-multi` model is derived from the upstream Vosk
project and is **not included as a Git-tracked model file here**.
`src/vosk-tts-engine.js` currently downloads a quantized model archive from
[CurtMil/gb-vosk-tts-model](https://huggingface.co/CurtMil/gb-vosk-tts-model)
at runtime. The public model-card metadata declares `apache-2.0`; the model
weights and quantized re-hosting are not claimed as newly authored by this
repository. The distribution/attribution record for the external hosting and
quantization should be verified at that separate publishing surface.

Browser inference uses third-party `onnxruntime-web`; zip extraction uses
`fflate`. These libraries are fetched separately by the host integration,
not vendored as sources in this repository. Their own applicable terms remain
in force.
