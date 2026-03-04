// OCR 数据上传功能的类型定义

export interface OCRJobFile {
  id: string;
  file_name: string;
  category?: string;
  status: "queued" | "requesting" | "uploading" | "processing" | "downloading" | "done" | "failed";
  progress: number;
  pages?: number;
  total_pages?: number;
  processed_pages?: number;
  error?: string;
  batch_id?: string;
  markdown_path?: string;
  output_dir?: string;
  created_at?: string;
  updated_at?: string;
}

export interface OCRJob {
  job_id: string;
  created_at: string;
  updated_at: string;
  files: OCRJobFile[];
}

export interface OCRSubmitResponse {
  job_id: string;
  accepted_count: number;
  rejected_count: number;
  rejected_files: string[];
  deduplicated_count?: number;
  deduplicated_files?: string[];
  files: Array<{
    id: string;
    file_name: string;
  }>;
}

export interface OCRSummary {
  total_files: number;
  total_pages: number;
  total_images: number;
  categories: Array<{
    category: string;
    total_files: number;
    total_pages: number;
    total_images: number;
  }>;
  documents: Array<{
    name: string;
    category: string;
    markdown_path: string;
    pages: number;
    images: number;
    source_file_hash?: string;
    updated_at: string;
  }>;
}

export interface OCRDestinations {
  root: string;
  destinations: string[];
}

export type OCRStatus = "idle" | "uploading" | "processing" | "completed" | "error";

// ---- 向量化处理 ----

export interface IngestionDocState {
  file_name: string;
  markdown_path: string;
  status: "not_started" | "in_progress" | "complete" | "failed";
  doc_id?: string;
  chunks_count: number;
  images_processed: number;
  version?: number;
  ingested_at?: string;
  ingest_error?: string;
}

export interface IngestionReportResponse {
  total: number;
  not_started: number;
  in_progress: number;
  complete: number;
  failed: number;
  documents: IngestionDocState[];
}

export interface BatchIngestionResponse {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  added: number;
  updated: number;
  documents: Array<Record<string, unknown>>;
}

export interface IngestionStatus {
  milvus_vectors: number;
  mongodb_documents: number;
  mongodb_chunks: number;
}

export type VectorStatus = "idle" | "loading" | "ingesting" | "completed" | "error";

// ---- 图谱化处理 ----

export interface GraphBuildResponse {
  doc_id: string;
  entities_count: number;
  relationships_count: number;
  status: string;
}

export interface BatchGraphBuildResponse {
  total: number;
  success: number;
  failed: number;
  documents: Array<{
    doc_id: string;
    file_name?: string;
    entities_count: number;
    relationships_count: number;
    status: string;
    error?: string;
  }>;
}

export interface BatchGraphBuildStateResponse {
  status: "idle" | "running" | "completed" | "failed";
  in_flight: boolean;
  started_at?: string | null;
  finished_at?: string | null;
  error?: string | null;
  result?: BatchGraphBuildResponse | null;
}

export interface GraphStatistics {
  total_nodes: number;
  total_relationships: number;
  entity_types: string[];
  entity_counts: Record<string, number>;
  doc_count: number;
}

export type GraphStatus = "idle" | "building" | "completed" | "error";

// ---- 图谱文档状态（来自 Neo4j :Document 节点） ----

export interface GraphDocumentStatus {
  doc_id: string;
  file_name: string;
  kg_status: string;
  entities_count: number;
  relationships_count: number;
  phase?: string;
  progress?: number | null;
  processed_chunks?: number | null;
  total_chunks?: number | null;
  error?: string;
}

export interface GraphDocumentStatusResponse {
  documents: GraphDocumentStatus[];
}

// ---- 一键校验 ----

/** /health/db 返回的数据库统计 */
export interface HealthDbResponse {
  status: "ok" | "error";
  error?: string;
  databases: {
    milvus?: { num_entities?: number; exists?: boolean; error?: string };
    mongodb?: { documents?: number; chunks?: number; error?: string };
    neo4j?: { node_count?: number; relationship_count?: number; labels?: string[]; error?: string };
  };
}

/** /ingestion/repair (dry_run) 返回的一致性检查结果 */
export interface ConsistencyRepairResponse {
  dry_run: boolean;
  target_docs: number;
  mongo_documents: number;
  mongo_chunks: number;
  milvus_vectors_scanned: number;
  graph_documents: number;
  orphan_chunks: number;
  orphan_vectors: number;
  orphan_graph_documents: number;
  inconsistent_docs: Array<{
    doc_id: string;
    mongo_chunks: number;
    milvus_vectors: number;
  }>;
  repaired: {
    deleted_orphan_chunks: number;
    deleted_orphan_vectors: number;
    deleted_orphan_graph_docs: number;
    deleted_orphan_graph_entities: number;
    cleaned_inconsistent_docs: number;
  };
}

/** 单项校验结果 */
export interface CheckItem {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

/** 聚合后的校验报告 */
export interface VerificationReport {
  timestamp: string;
  overall: "pass" | "warn" | "fail";
  stats: {
    ocr_files: number;
    mongo_documents: number;
    mongo_chunks: number;
    milvus_vectors: number;
    graph_nodes: number;
    graph_relationships: number;
  };
  checks: CheckItem[];
  inconsistent_docs: ConsistencyRepairResponse["inconsistent_docs"];
}

export type VerificationStatus = "idle" | "checking" | "completed" | "error";
