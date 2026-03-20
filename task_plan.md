# Task Plan

## Goal
Implement destructive reset behavior with explicit user confirmation for OCR, vector ingestion, graph build, and all-in-one reset flows. Also fix the vector upload production build failure caused by nullable ingestion reports.

## Phases
- [completed] Document confirmed requirements and inspect current reset implementation.
- [completed] Add failing tests for refresh and reset behavior.
- [completed] Implement backend reset endpoints and frontend confirmation dialogs.
- [completed] Add regression coverage for nullable ingestion reports during vector refresh.
- [completed] Fix vector upload build failure by guarding nullable merged reports.
- [completed] Verify behavior with targeted tests.

## Confirmed Requirements
- Vector page refresh should turn failed items back into `not_started` in the UI.
- Vector page build must not fail when merged/normalized ingestion report is `null`.
- OCR reset deletes OCR output data.
- Vector reset primarily deletes MongoDB and Milvus ingestion data.
- Graph reset deletes Neo4j graph data.
- Every destructive reset must show a warning confirmation dialog before executing.
- All-in-one reset should clear OCR outputs, vector data, and graph data.
