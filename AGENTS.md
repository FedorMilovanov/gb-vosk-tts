# Agent operating rules — gb-vosk-tts

Read README.md, ARCHITECTURE.md, OWNER.md, LICENSING.md and SECURITY.md for the affected surface. This integration is not an independently owned speech model. Preserve upstream attribution, model/data provenance, exact input identity, browser-runtime and downstream acceptance boundaries. Use a bounded branch/PR from current main; do not edit another agent's branch or publish downstream from test evidence alone.

## Shared workstation policy

Follow the [shared execution resource protocol](https://github.com/FedorMilovanov/AuditRepo/blob/main/LOCAL_EXECUTION_RESOURCE_PROTOCOL.md) (AuditRepo main). Minimum independent rules:

- GitHub connector/API first for repository state, files, changes, CI and artifacts; hosted sandbox/CI for offline tests and browser checks. Remote Desktop Commander (RDC) only when the actual workstation or an existing device-bound model/audio artifact is necessary; justify, batch commands, compact results, one process/call ID, reconcile before replay. Do not download a duplicate model/archive or launch repeated inference for the same exact evidence. No account switching to evade limits.
- Heavy Windows tasks require fresh shared admission and Commit/RAM/disk counters: warn at 75%, deny new heavy jobs at 80%, diagnose at 90%; free RAM >=6 GiB, free disk >=15 GiB (or larger artifact reserve). Unknown admission means CI/HOLD. One heavy task workstation-wide before verified controller rollout; after rollout respect its enforced slots, at most two. No parallel engines.
- No local Windows WebKit/CUDA by default. Explicit owner-approved bounded exceptions only; do not change the speech model, quantization, stress dictionary, runtime provider, or fidelity silently. Browser probe 10 min / heavy QA 20 min; extended media tasks need a justified deadline. Close owned children in finally; external watchdog, no blanket termination of owner or unrelated processes.
- Preserve current licensing and provenance, Node test gates, actual browser playback and downstream release evidence as separate checks. Report transport, actual RDC calls, evidence, cleanup and remaining HOLD.
