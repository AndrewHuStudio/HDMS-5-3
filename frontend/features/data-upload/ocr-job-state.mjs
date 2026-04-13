function normalizeDocName(value) {
  return String(value || "").replace(/\.pdf$/i, "").trim().toLowerCase();
}

function toTerminalStatus(file, summaryDoc) {
  if (file?.status === "failed") {
    return {
      ...file,
      progress: 100,
    };
  }

  if (!summaryDoc) {
    return file;
  }

  const pages = Number(summaryDoc.pages ?? file?.pages ?? file?.total_pages ?? 0);

  return {
    ...file,
    status: "done",
    progress: 100,
    pages,
    total_pages: pages,
    markdown_path: summaryDoc.markdown_path || file?.markdown_path,
    updated_at: summaryDoc.updated_at || file?.updated_at,
  };
}

export function recoverCompletedOcrJob({ currentJob, summaryDocuments }) {
  if (!currentJob || !Array.isArray(currentJob.files) || currentJob.files.length === 0) {
    return null;
  }

  const summaryByName = new Map(
    (summaryDocuments || []).map((doc) => [normalizeDocName(doc?.name), doc]),
  );

  const recoveredFiles = currentJob.files.map((file) =>
    toTerminalStatus(file, summaryByName.get(normalizeDocName(file?.file_name))),
  );

  const allTerminal = recoveredFiles.every(
    (file) => file?.status === "done" || file?.status === "failed",
  );
  if (!allTerminal) {
    return null;
  }

  return {
    ...currentJob,
    files: recoveredFiles,
  };
}
