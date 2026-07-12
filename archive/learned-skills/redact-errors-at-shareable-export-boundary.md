# Never put raw String(describing: error) into a user-shareable diagnostic export — redact to domain+code at the sink

**Extracted:** 2026-07-12
**Context:** Mined from Cubby iOS session logs (0022); adversarially verified.

## Problem
A shareable diagnostic-log feature that explicitly promised 'no personal content' fed raw `String(describing: error)` from several ML/AI-pipeline error sinks (model load, generation, refiner failure) directly into the exportable buffer. In practice an NSError from a model-load failure can embed the absolute on-device container path, and a FoundationModels/OCR-adjacent error can embed OCR'd text from the user's own item photo — both leak into a file the user might share for support, silently violating the feature's own privacy promise. This was found by a security review, not by design, and was not visible from reading any single call site in isolation — only from tracing what actually ends up in the shareable buffer.

## Solution
At every sink that feeds a user-facing/shareable export (diagnostic logs, crash reporters users can send, 'copy error' buttons), apply a redaction boundary that reduces any caught Error/NSError to its structural identity only (domain + code), never its localized description or `String(describing:)`. Keep the raw, unredacted error in developer-only surfaces (OSLog `.public`/private system logs) where the threat model is different (system log access, not casual user sharing) — treat that as a separate, still-open surface to redact if the threat model includes sysdiagnose export.

## Evidence
Session 0022: '#1 privacy (CONFIRMED) — the shareable DiagnosticLog (promises "no personal content") received raw String(describing: error) from the AI-naming sink; a load/generation NSError can carry the model's absolute container path, a FoundationModels error can carry OCR'd label text. New DiagnosticErrorRedactor.safeLabel -> domain #code only, applied at the 4 sink sites.'

## When to Use
Any app with a 'share diagnostics' or 'copy error details' feature that touches ML/Vision/OCR/file-path-bearing errors is one `String(describing: error)` away from leaking absolute paths or user content into an export the user believes is anonymized — this is a general privacy-engineering pattern for building shareable diagnostic buffers, not specific to Cubby's VLM stack.
