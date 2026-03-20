# Findings

- Current vector refresh only reloads report data; it does not remap failed items to `not_started`.
- Vector upload panel computed completion state from `finalReport` without guarding the nullable return from refresh normalization, which broke Next.js TypeScript build.
- Current reset buttons in OCR/vector/graph/verification panels only reset frontend store state.
- OCR backend already exposes `/api/outputs/clear`.
- Vector backend already supports per-document deletion, but no bulk clear endpoint exists.
- Graph backend appears to expose a graph clear endpoint that should be inspected for reuse.
- Added bulk ingestion clear via `/ingestion/clear`, which recreates the Milvus collection and clears Mongo ingestion collections.
- Verification-panel reset can orchestrate OCR clear, ingestion clear, and graph clear without a dedicated backend "reset all" endpoint.
- Local panel refresh behavior can be adjusted safely in frontend by normalizing failed ingestion states back to `not_started`.
- The cleanest fix is to centralize the completion check in a null-safe helper shared by tests and the vector upload panel.
