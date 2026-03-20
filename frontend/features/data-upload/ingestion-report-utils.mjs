/**
 * @typedef {Object} OcrDocumentLite
 * @property {string} markdown_path
 */

/**
 * @typedef {Object} IngestionDocLite
 * @property {string} file_name
 * @property {string} markdown_path
 * @property {string} status
 * @property {number} [chunks_count]
 * @property {number} [images_processed]
 * @property {string} [doc_id]
 * @property {string} [ingested_at]
 * @property {string} [ingest_error]
 * @property {number} [version]
 */

/**
 * @typedef {Object} IngestionReportLite
 * @property {number} total
 * @property {number} not_started
 * @property {number} in_progress
 * @property {number} complete
 * @property {number} failed
 * @property {IngestionDocLite[]} documents
 */

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").trim();
}

function normalizeStatus(value) {
  const raw = String(value || "").trim();
  if (raw === "complete" || raw === "in_progress" || raw === "failed" || raw === "not_started") {
    return raw;
  }
  return "not_started";
}

function statusPriority(status) {
  switch (normalizeStatus(status)) {
    case "complete":
      return 3;
    case "in_progress":
      return 2;
    case "failed":
      return 1;
    default:
      return 0;
  }
}

function pickBetterDoc(nextDoc, prevDoc) {
  const nextPriority = statusPriority(nextDoc.status);
  const prevPriority = statusPriority(prevDoc.status);
  if (nextPriority > prevPriority) return nextDoc;
  if (nextPriority < prevPriority) return prevDoc;

  const nextChunks = Number(nextDoc.chunks_count || 0);
  const prevChunks = Number(prevDoc.chunks_count || 0);
  if (nextChunks > prevChunks) return nextDoc;
  if (nextChunks < prevChunks) return prevDoc;

  return nextDoc;
}

/**
 * 从 markdown_path 推导 ingestion 报告查询目录。
 * 规则：去掉最后 2 段（<doc>/<file.md>）。
 *
 * @param {string} markdownPath
 * @returns {string}
 */
export function deriveIngestionScopeDir(markdownPath) {
  const normalized = normalizePath(markdownPath);
  if (!normalized) return "";
  const parts = normalized.split("/");
  if (parts.length >= 3) {
    return parts.slice(0, -2).join("/");
  }
  return parts.slice(0, -1).join("/");
}

/**
 * 根据 OCR 文档列表提取去重后的 ingestion 查询目录。
 *
 * @param {OcrDocumentLite[]} ocrDocs
 * @returns {string[]}
 */
export function buildIngestionScopeDirs(ocrDocs) {
  const seen = new Set();
  const dirs = [];
  for (const doc of ocrDocs || []) {
    const dir = deriveIngestionScopeDir(doc?.markdown_path || "");
    if (!dir) continue;
    const key = dir.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dirs.push(dir);
  }
  return dirs;
}

/**
 * 合并多个 ingestion 报告，避免后批次覆盖前批次。
 *
 * @param {Array<IngestionReportLite | null | undefined>} reports
 * @returns {IngestionReportLite}
 */
export function mergeIngestionReports(reports) {
  /** @type {Map<string, IngestionDocLite>} */
  const mergedMap = new Map();

  for (const report of reports || []) {
    if (!report || !Array.isArray(report.documents)) continue;

    for (const doc of report.documents) {
      const markdownPath = normalizePath(doc?.markdown_path || "");
      const fileName = String(doc?.file_name || "").trim();
      const key = (markdownPath || fileName).toLowerCase();
      if (!key) continue;

      const normalizedDoc = {
        ...doc,
        status: normalizeStatus(doc?.status),
      };

      const existing = mergedMap.get(key);
      mergedMap.set(key, existing ? pickBetterDoc(normalizedDoc, existing) : normalizedDoc);
    }
  }

  const documents = Array.from(mergedMap.values()).sort((a, b) => {
    const left = String(a.file_name || a.markdown_path || "");
    const right = String(b.file_name || b.markdown_path || "");
    return left.localeCompare(right, "zh-CN");
  });

  const counts = {
    not_started: 0,
    in_progress: 0,
    complete: 0,
    failed: 0,
  };
  for (const doc of documents) {
    const status = normalizeStatus(doc.status);
    counts[status] += 1;
  }

  return {
    total: documents.length,
    not_started: counts.not_started,
    in_progress: counts.in_progress,
    complete: counts.complete,
    failed: counts.failed,
    documents,
  };
}

/**
 * 刷新时将失败项恢复为待开始，方便用户重新发起向量化。
 *
 * @param {IngestionReportLite | null | undefined} report
 * @returns {IngestionReportLite | null}
 */
export function normalizeIngestionReportForRefresh(report) {
  if (!report || !Array.isArray(report.documents)) {
    return null;
  }

  const documents = report.documents.map((doc) => {
    if (normalizeStatus(doc?.status) !== "failed") {
      return {
        ...doc,
        status: normalizeStatus(doc?.status),
      };
    }
    return {
      ...doc,
      status: "not_started",
      ingest_error: undefined,
    };
  });

  const counts = {
    not_started: 0,
    in_progress: 0,
    complete: 0,
    failed: 0,
  };
  for (const doc of documents) {
    counts[normalizeStatus(doc.status)] += 1;
  }

  return {
    total: documents.length,
    not_started: counts.not_started,
    in_progress: counts.in_progress,
    complete: counts.complete,
    failed: counts.failed,
    documents,
  };
}

/**
 * 判断 ingestion 报告是否已全部完成。
 *
 * @param {IngestionReportLite | null | undefined} report
 * @returns {boolean}
 */
export function isIngestionReportComplete(report) {
  if (!report) return false;

  return (
    report.total > 0 &&
    report.in_progress === 0 &&
    report.not_started === 0 &&
    report.complete + report.failed === report.total
  );
}
