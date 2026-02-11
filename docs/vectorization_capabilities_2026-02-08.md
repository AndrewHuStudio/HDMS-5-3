# Vectorization Capability Summary (2026-02-08)

## Purpose
This document summarizes the current capabilities of the vector ingestion pipeline in `data_process/vector_process`.

---

## 1) Core Capabilities

### 1.1 Document-level incremental update
- Uses `content_hash` to deduplicate unchanged content.
- For the same markdown path, changed content enters update flow instead of blind full rebuild.
- Maintains lifecycle fields such as `ingest_status`, `ingest_error`, `version`, `updated_at`.

### 1.2 Chunk-level diff update
- Stores `chunk_hash` for each chunk.
- Compares old/new chunks with `chunk_index + chunk_hash`:
  - unchanged chunk: reuse, no re-embedding
  - changed/new chunk: embed only changed/new chunks
  - removed old chunk: delete from MongoDB and Milvus
- Tracks: `unchanged_chunks`, `updated_chunks`, `removed_chunks`, `embeddings_generated`.

### 1.3 Document version management
- Archives old versions into `document_versions` when document content changes.
- Supports version history query.
- Supports rollback to a historical version.

### 1.4 Batch incremental ingestion
- Scans OCR output directory and identifies valid docs (`.md + .meta.json`).
- Batch metrics include:
  - `added`
  - `updated`
  - `skipped`
  - `failed`

### 1.5 Multi-store consistency governance (Milvus / MongoDB / Neo4j)
- Supports per-document cross-store deletion.
- Supports consistency check/repair:
  - orphan chunks
  - orphan vectors
  - orphan graph documents
  - chunk/vector count mismatch
- Supports dry-run and apply mode.

---

## 2) Ingestion API Endpoints

### Ingestion
- `POST /ingestion/document`
- `POST /ingestion/batch`
- `POST /ingestion/report`
- `GET /ingestion/status`

### Version and rollback
- `GET /ingestion/document/{doc_id}/versions`
- `POST /ingestion/document/rollback`

### Cleanup and repair
- `DELETE /ingestion/document`
- `POST /ingestion/repair`

---

## 3) MongoDB Data Model Highlights

### `documents`
- `_id`, `file_name`, `category`, `markdown_path`
- `full_text`, `metadata`
- `content_hash`, `version`
- `ingest_status`, `ingest_error`
- `chunks_count`, `images_processed`
- `ingested_at`, `updated_at`, `created_at`

### `chunks`
- `_id`, `doc_id`, `chunk_index`
- `text`, `enhanced_text`
- `chunk_hash`, `version`
- `section_title`, `has_table`, `has_image`
- `embedding_dimension`

### `document_versions`
- `_id(doc_id:vN)`, `doc_id`, `version`
- `content_hash`, `full_text`, `metadata`
- `chunks_count`, `images_processed`
- `created_at`, `archived_at`, `source`

---

## 4) Current Boundaries
- Diff is based on `chunk_index + chunk_hash`. Large front-part edits may still trigger many chunk updates.
- Repair is currently cleanup-first, then re-ingestion.
- Rollback reuses historical text/metadata snapshot; strict historical image-state replay is not included.

---

## 5) Conclusion
The requested goals are now covered at a practical level:
- incremental update
- chunk-level diff
- versioning and rollback
- batch incremental report
- cross-store consistency repair

Further work can focus on chunk alignment strategy and historical migration tooling.
