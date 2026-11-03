# Ownership and attribution

**Repository maintainer:** [FedorMilovanov](https://github.com/FedorMilovanov). This repository is a browser integration and Russian word-stress layer for an existing open-source TTS engine; it is **not** an original speech-synthesis model.

## What this project is responsible for

- The site-specific vocabulary in `data/custom-terms.json`, with confidence and source-review notes in `data/REVIEW-custom-terms.md`.
- The layering and browser integration in `src/stress-lookup.js`, `src/vosk-tts-core.js` and `src/vosk-tts-engine.js`, and the associated Node tests.
- Maintenance, evaluation, downstream integration and the project's published documentation and security policy.

The repository is developed and maintained through human-directed work with software and AI tooling. Repository ownership **does not establish that every line was personally written by the account holder**. Do not infer authorship of a particular change from aggregate commit or line counts.

## Third-party boundaries

| Component | Origin and terms | Ownership boundary |
|---|---|---|
| Base TTS pipeline and model | [alphacep/vosk-tts](https://github.com/alphacep/vosk-tts), Apache-2.0 | Not authored or owned by this repository; the model is downloaded at runtime, not redistributed here |
| Word-form dictionary `data/russian-stress-marker.bin` | [zdarsch/russian-stress-marker](https://github.com/zdarsch/russian-stress-marker), MIT | Vendored third-party data; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) |
| Browser inference library | onnxruntime-web, externally loaded by the host integration | Not authored by this repository |
| Original project files | [LICENSE](LICENSE) and the qualifications in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | Copyright statement and scope are limited to the material described there |

For the technical boundary see [ARCHITECTURE.md](ARCHITECTURE.md); for what was solved and what **has not** been demonstrated, see [CASE_STUDY.md](CASE_STUDY.md).

## Maintenance and contact

Use repository issues for non-sensitive reports. For credentials or exploitable findings follow [SECURITY.md](SECURITY.md); never disclose a live secret publicly. No email or private contact address is asserted here without owner confirmation.
