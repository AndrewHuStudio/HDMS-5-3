/**
 * @typedef {Object} MergedOcrRow
 * @property {string} key
 * @property {string} fileName
 * @property {number} fileSize
 * @property {Object|null} ocrFile
 * @property {"selected" | "job" | "summary"} source
 */

/**
 * 构建 OCR 展示行（当前行为：仅当无任何当前行时才回填历史 summary）。
 *
 * @param {{
 *   selectedFiles: Array<{ name: string; size: number }>,
 *   jobFiles: Array<any>,
 *   summaryDocuments: Array<{ name: string; markdown_path?: string; pages?: number }>
 * }} params
 * @returns {MergedOcrRow[]}
 */
export function buildMergedOcrRows(params) {
  const { selectedFiles, jobFiles, summaryDocuments } = params;

  const jobFileMap = new Map(jobFiles.map((file) => [file.file_name, file]));

  /** @type {MergedOcrRow[]} */
  const mergedRows = selectedFiles.map((file) => ({
    key: file.name,
    fileName: file.name,
    fileSize: file.size,
    ocrFile: jobFileMap.get(file.name) ?? null,
    source: "selected",
  }));

  for (const jobFile of jobFiles) {
    if (!selectedFiles.some((file) => file.name === jobFile.file_name)) {
      mergedRows.push({
        key: jobFile.file_name,
        fileName: jobFile.file_name,
        fileSize: 0,
        ocrFile: jobFile,
        source: "job",
      });
    }
  }

  // 新增文件时也保留历史 summary；按文档名去重（忽略 .pdf 后缀）
  const normalizeName = (value) => value.replace(/\.pdf$/i, "").trim().toLowerCase();
  const shownNameSet = new Set(mergedRows.map((row) => normalizeName(row.fileName)));

  for (const doc of summaryDocuments) {
    const normalizedDocName = normalizeName(doc.name);
    if (shownNameSet.has(normalizedDocName)) {
      continue;
    }

    mergedRows.push({
      key: `summary-${doc.name}`,
      fileName: doc.name,
      fileSize: 0,
      ocrFile: {
        id: `summary-${doc.name}`,
        file_name: doc.name,
        status: "done",
        pages: doc.pages ?? 0,
        total_pages: doc.pages ?? 0,
        progress: 100,
        markdown_path: doc.markdown_path,
      },
      source: "summary",
    });
    shownNameSet.add(normalizedDocName);
  }

  return mergedRows;
}
