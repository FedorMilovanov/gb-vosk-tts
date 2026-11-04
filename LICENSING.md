# License and source-provenance map

Updated 2026-11-04. This file records sources and licensing boundaries, **not**
a legal opinion or proof that every upstream right has been independently audited.

## Classification by file

| File or asset | Origin | Applicable license / required attribution |
|---|---|---|
| `src/vosk-tts-core.js` | JavaScript adaptation of `alphacep/vosk-tts` Python text-processing rules, mappings and stream preparation | **Apache-2.0** (conservative classification for the whole ported file). Preserve full upstream license, change notice and source credit |
| `src/vosk-tts-engine.js` | Project-specific browser integration: model fetch, checksum, inference, caching and playback | **MIT** for original integration code; the externally downloaded model and ONNX runtime are distinct |
| `src/stress-lookup.js` | Adaptation of `zdarsch/russian-stress-marker` decoder and its mapping tables, plus project-specific layered lookup | **MIT** with source copyright/permission notice retained |
| `data/russian-stress-marker.bin` | Vendored word-form FSA from `zdarsch/russian-stress-marker` | **MIT**, Copyright (c) 2024 zdarsch |
| `data/custom-terms.json`, project-specific `tools/`, `tests/`, docs | Project work | **MIT** for original portions, unless separately indicated |
| Quantized `vosk-model-tts-ru-0.9-multi` fetched at runtime | Upstream Vosk speech model, hosted as `CurtMil/gb-vosk-tts-model` | External model; Hugging Face card declares **Apache-2.0**. Changes to model weights/redistribution and the original model's notices require verification at hosting surface |
| `onnxruntime-web`, `fflate` | External JS dependencies loaded by browser integration | Separate upstream packages, not licensed by this repository |

## Evidence and change history

1. Original pipeline: [alphacep/vosk-tts](https://github.com/alphacep/vosk-tts)
   at `vosk_tts/g2p.py`, `vosk_tts/model.py` and `vosk_tts/synth.py`.
   Upstream repository publishes an [Apache-2.0 license](https://github.com/alphacep/vosk-tts/blob/master/LICENSE).
   Complete verbatim license:
   [THIRD_PARTY_LICENSES/vosk-tts-APACHE-2.0.txt](THIRD_PARTY_LICENSES/vosk-tts-APACHE-2.0.txt).
   The JavaScript translation retains recognizably similar phoneme tables,
   processing order and text-stream behavior. Thus a lack of verbatim
   Python source text does **not** justify calling it an independent original.
2. This project's 2026 adaptation for the browser adds JS modules, a BERT
   WordPiece implementation, number normalization, browser input preparation
   and a documented correction to mid-word hyphen handling. The prominent
   change notice appears in `src/vosk-tts-core.js` and
   [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
3. Original dictionary/decoder:
   [zdarsch/russian-stress-marker](https://github.com/zdarsch/russian-stress-marker),
   specifically `ru_stress_marker/content.js` and the word-form FSA.
   Its [original MIT notice](THIRD_PARTY_LICENSES/russian-stress-marker-MIT.txt)
   is preserved. `src/stress-lookup.js` adapts that algorithm and output
   encoding to Vosk-style stress notation; this is an adaptation, not a new
   invention of its source dictionary or decoder.
4. Browser speech model:
   [CurtMil/gb-vosk-tts-model](https://huggingface.co/CurtMil/gb-vosk-tts-model)
   displays `apache-2.0` on its model-card metadata. The repository's JS
   engine points at a `model-quant.zip` archive and pins its SHA-256. This
   Git repository does not store the archive. **The external hosting card and
   any quantized redistribution need their own clear original provenance,
   modification description, and required rights notices.** Do not assume
   a license declared in a model card proves a complete rights audit.

## Redistribution rules

- The root [LICENSE](LICENSE) is the project's standard **MIT** text for
  portions owned/licensable under MIT; it does **not** relicense
  `src/vosk-tts-core.js` or the external model.
- Copies of the Apache-governed port must retain the Apache 2.0 license,
  upstream attribution and prominent modification notice; see the original
  license's §4 conditions.
- Copies of the MIT-governed upstream decoder/data must retain the original
  zdarsch copyright and permission text.
- Contributions must not silently overwrite the provenance of a third-party
  file or assert sole ownership because the code was translated or modified.
- For production deployment, keep third-party attribution accessible and
  verify the separate model-hosting surface before claiming all model
  redistribution rights are resolved.

## Verification limits

This classification was made by comparing the published original sources,
the current JavaScript modules and the actual upstream license texts.
It is **not** a byte-by-byte authorship proof, full dependency-license audit,
model-weight provenance audit or legal advice. Changes to model weights,
the external hosting card or third-party code require a new review.
