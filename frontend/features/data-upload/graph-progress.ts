export type GraphDocStatus =
  | "success"
  | "failed"
  | "in_progress"
  | "pending"
  | "waiting_vector"
  | "vector_failed";

export interface GraphProgressRow {
  key: string;
  docId: string | null;
  fileName: string;
  status: GraphDocStatus;
  progress: number;
  entitiesCount: number | null;
  relationshipsCount: number | null;
  error?: string;
}

type IngestionReportDoc = {
  file_name: string;
  markdown_path: string;
  status: "not_started" | "in_progress" | "complete" | "failed";
  doc_id?: string;
};

type GraphBuiltDoc = {
  doc_id: string;
  file_name?: string;
  status: string;
  progress?: number | null;
  entities_count: number;
  relationships_count: number;
  error?: string;
};

function _basename(p: string): string {
  const s = String(p || "");
  const parts = s.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || "";
}

function _stripExt(name: string): string {
  const base = _basename(name);
  const idx = base.lastIndexOf(".");
  return idx > 0 ? base.slice(0, idx) : base;
}

function _normName(name: string): string {
  return _stripExt(name).trim().toLowerCase();
}

function _isBuiltSuccess(status: string): boolean {
  // "skipped" means already built (idempotent batch mode).
  return status === "success" || status === "skipped";
}

function _normalizeBuiltStatus(status: string): GraphDocStatus {
  if (_isBuiltSuccess(status)) return "success";
  if (status === "in_progress" || status === "running") return "in_progress";
  if (status === "failed") return "failed";
  return "pending";
}

function _normalizeProgress(value: number | null | undefined): number {
  if (value == null || Number.isNaN(Number(value))) return 0;
  const progress = Math.floor(Number(value));
  return Math.min(100, Math.max(0, progress));
}

export function buildGraphProgressRows(
  reportDocs: IngestionReportDoc[],
  builtDocs: GraphBuiltDoc[],
): GraphProgressRow[] {
  const byDocId = new Map<string, GraphBuiltDoc>();
  const byNormFile = new Map<string, GraphBuiltDoc>();

  for (const doc of builtDocs || []) {
    if (doc?.doc_id) byDocId.set(String(doc.doc_id), doc);
    const k = _normName(doc?.file_name || "");
    if (k) byNormFile.set(k, doc);
  }

  return (reportDocs || []).map((doc) => {
    const built =
      (doc.doc_id ? byDocId.get(String(doc.doc_id)) : undefined) ||
      byNormFile.get(_normName(doc.file_name));

    if (built) {
      const builtStatus = String(built.status || "");
      const normalizedBuiltStatus = _normalizeBuiltStatus(builtStatus);
      return {
        key: String(built.doc_id),
        docId: String(built.doc_id),
        fileName: built.file_name || doc.file_name,
        status: normalizedBuiltStatus,
        progress:
          normalizedBuiltStatus === "success"
            ? 100
            : normalizedBuiltStatus === "in_progress"
              ? _normalizeProgress(built.progress)
              : normalizedBuiltStatus === "failed"
                ? 100
                : 0,
        entitiesCount: built.entities_count ?? 0,
        relationshipsCount: built.relationships_count ?? 0,
        error: built.error,
      };
    }

    return {
      key: doc.markdown_path,
      docId: doc.doc_id ? String(doc.doc_id) : null,
      fileName: doc.file_name,
      status:
        doc.status === "complete"
          ? "pending"
          : doc.status === "failed"
            ? "vector_failed"
            : "waiting_vector",
      progress: 0,
      entitiesCount: null,
      relationshipsCount: null,
    };
  });
}

export function computeGraphPanelStats(
  progressRows: GraphProgressRow[],
  statistics?: { doc_count?: number; total_nodes?: number; total_relationships?: number } | null,
): {
  statDocs: number;
  statSuccess: number;
  statFailed: number;
  statNodes: number;
  statRels: number;
} {
  const rows = progressRows || [];
  const successRows = rows.filter((d) => d.status === "success");
  const failedRows = rows.filter((d) => d.status === "failed");

  const totalEntities = successRows.reduce((sum, d) => sum + (d.entitiesCount ?? 0), 0);
  const totalRelations = successRows.reduce((sum, d) => sum + (d.relationshipsCount ?? 0), 0);

  const hasRows = rows.length > 0;

  return {
    statDocs: hasRows ? rows.length : Number(statistics?.doc_count ?? 0),
    statSuccess: hasRows ? successRows.length : Number(statistics?.doc_count ?? 0),
    statFailed: hasRows ? failedRows.length : 0,
    statNodes: Number(statistics?.total_nodes ?? totalEntities),
    statRels: Number(statistics?.total_relationships ?? totalRelations),
  };
}
