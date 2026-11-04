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

## Model archive provenance: verified trail and remaining gates (2026-11-04)

These are **separate evidence levels**. A documented transformation or an integrity
hash is not, by itself, proof of the original weights' rights or reproducibility.

| Stage | Evidence | Established | Not established |
|---|---|---|---|
| Upstream | [Alpha Cephei `vosk-tts` README](https://github.com/alphacep/vosk-tts#readme), linking the `vosk-model-tts-ru-0.9-multi.zip` download; the project's Apache-2.0 license | The model name and original project distribution link, with upstream attribution | A verified SHA-256 of the **upstream** archive, or an inspection of its internal model-specific licenses/notices |
| Project's original upload | [`gb-vosk-tts` release `model-v1`](https://github.com/FedorMilovanov/gb-vosk-tts/releases/tag/model-v1), 2026-07-07: `vosk-model-tts-ru-0.9-multi.zip`, **782,787,154 bytes**, GitHub asset digest `sha256:0aa332451ce46bfdbd620e74765fc16a4087988067c299969121ed0f8ed5bdf2` | An immutable, source-host-computed fingerprint of this project's unquantized upload; the [July 8 audit](https://github.com/FedorMilovanov/AuditRepo/blob/main/projects/gb-is-my-strength/incoming/tts-quality-audit-2026-07-08-arena-agent-cleanup/REPORT.md) records an independent local match | That these bytes are identical to the original Alpha Cephei download |
| Quantization method, historical test | [Integration report](https://github.com/FedorMilovanov/AuditRepo/blob/main/projects/gb-is-my-strength/incoming/vosk-tts-integration-2026-07-06/REPORT.md) (round 4, archived), corroborated by [current engine comments](src/vosk-tts-engine.js) | Reported ONNX Runtime `quantize_dynamic()` **INT8 dynamic weight-only quantization of the BERT ONNX submodel** (~654 MB → ~156.5 MB); the VITS model (~179 MB) was retained unquantized after a `MatMulInteger` inference-shape failure; archive ~782 MB → ~280 MB; an actual speech A/B check was recorded | Exact quantization command, ONNX Runtime/Python versions, input/output model digests, full per-file before/after inventory, or an independently repeated conversion; the archived listening claim is not a reproduced test today |
| Published quantized copy | [Hugging Face repository](https://huggingface.co/CurtMil/gb-vosk-tts-model/tree/main) (unquantized upload `9d98550`, quantized upload `050d909`, July 2026); [engine](src/vosk-tts-engine.js) fetches `model-quant.zip` and expects SHA-256 `34e742ce9bb3c1ae86679d5974d2496b9fae50f0629f51bb4f5edfadc5ff3d71` | Hosting location, version history, application-level expected digest, and separately hosted original/quantized archives. Hosting card labels the repository `apache-2.0` | **No fresh independent download/hash verification of the hosted ZIP in this review**; no complete model-specific notices or clear modification statement were found in the minimal public model card |

**Precise outstanding model-rights gate (HOLD):**

1. Hash the upstream `vosk-model-tts-ru-0.9-multi.zip` and compare to the release archive above; inspect licenses/attribution/NOTICE **inside** the original and hosted ZIPs. A matching filename or same approximate size is not proof.
2. Recover the exact original quantization command, library versions and ONNX input/output fingerprints; rerun from the verified baseline and compare files, graph structure and actual audio behavior against the hosted `model-quant.zip`. If quantization is nondeterministic, record the precise non-byte-equivalence plus independently validated outputs, not a fictitious byte-identical claim.
3. Put source and rights attribution, a conspicuous modification notice for the quantized BERT graph, and any applicable license/NOTICE files on the **Hugging Face model-hosting surface**, in addition to preserving required notices in archives. Verify the resulting public revision.
4. Independently hash the currently served quantized ZIP and confirm the engine pin still matches. A digest protects transfer integrity; it does not convey training-data rights or prove permission to redistribute.

Until these are evidenced, **model provenance = PARTIAL; quantized-model rights/redistribution clearance = HOLD**. The earlier Apache/MIT remediation for JavaScript and the word-form dictionary remains separately closed; this new trail does not undo it.

---

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
