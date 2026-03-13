function normalizeDocName(value) {
  return String(value || "").replace(/\.pdf$/i, "").trim();
}

function normalizeKey(value) {
  return normalizeDocName(value).toLowerCase();
}

/**
 * 向量化候选文档：
 * - 若当前 OCR 任务存在，则仅取当前任务中 status=done 的文件
 * - 否则回退到 OCR summary（历史已完成文档）
 */
export function buildVectorSourceDocs({ currentJob, summary }) {
  const summaryDocs = summary?.documents ?? [];
  const summaryByName = new Map(summaryDocs.map((doc) => [normalizeKey(doc.name), doc]));

  const currentFiles = currentJob?.files ?? [];
  if (currentFiles.length > 0) {
    const doneDocs = [];
    for (const file of currentFiles) {
      if (file?.status !== "done" || !file?.markdown_path) {
        continue;
      }
      const key = normalizeKey(file.file_name);
      const summaryDoc = summaryByName.get(key);
      doneDocs.push({
        name: summaryDoc?.name || normalizeDocName(file.file_name),
        category: summaryDoc?.category || file.category || "",
        markdown_path: file.markdown_path,
        pages: Number(file.pages ?? file.total_pages ?? summaryDoc?.pages ?? 0),
        images: Number(summaryDoc?.images ?? 0),
      });
    }
    return doneDocs;
  }

  return summaryDocs.map((doc) => ({
    name: doc.name,
    category: doc.category,
    markdown_path: doc.markdown_path,
    pages: Number(doc.pages ?? 0),
    images: Number(doc.images ?? 0),
  }));
}

/**
 * 图谱候选文档：
 * 仅允许来自“向量化 complete”的文档，且需属于当前 OCR 候选集合。
 */
export function pickGraphEligibleDocs(vectorSourceDocs, ingestionDocs) {
  const sourceNames = new Set((vectorSourceDocs ?? []).map((doc) => normalizeKey(doc.name)));
  const eligible = [];
  for (const doc of ingestionDocs ?? []) {
    if (doc?.status !== "complete") {
      continue;
    }
    if (!sourceNames.has(normalizeKey(doc.file_name))) {
      continue;
    }
    eligible.push(doc);
  }
  return eligible;
}
