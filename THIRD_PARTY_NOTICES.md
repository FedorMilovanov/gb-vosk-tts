# Third-party notices

## data/russian-stress-marker.bin

Source: [zdarsch/russian-stress-marker](https://github.com/zdarsch/russian-stress-marker)
License: MIT (per the repository's `LICENSE` file, copyright 2024 zdarsch).

A compact finite-state automaton (raw `Uint32Array`) recognizing ~2,039,133
already-accented lowercase Russian word forms. Vendored here unmodified.
`src/stress-lookup.js`'s `StressMarkerDict` is an independent port of the
decoding algorithm from that repository's `ru_stress_marker/content.js`
(also MIT), rewritten to fit this project's module style and to convert
output into vosk-tts's own `+`-before-vowel stress convention instead of the
original's `'`/`` ` `` after-vowel accent marks.

## vosk-tts integration (src/vosk-tts-core.js, src/vosk-tts-engine.js)

These files are a from-scratch JavaScript port of the text-processing
pipeline (g2p rules, dictionary handling, phoneme stream assembly) from
[alphacep/vosk-tts](https://github.com/alphacep/vosk-tts) (Apache License
2.0), and a browser wrapper around its ONNX model
(`vosk-model-tts-ru-0.9-multi`, downloaded at runtime from alphacephei.com —
not redistributed in this repository). No vosk-tts source code is copied
verbatim; the port was written independently and verified against the real
Python package via differential testing (see `tests/`).
