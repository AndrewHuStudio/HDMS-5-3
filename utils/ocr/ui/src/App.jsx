import { useEffect, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_OCR_API_BASE || "http://localhost:8030";
const SUPPORTED_EXTS = new Set([".pdf"]);

const statusLabel = (status) => {
  switch (status) {
    case "queued":
      return "排队中";
    case "requesting":
      return "请求中";
    case "uploading":
      return "上传中";
    case "processing":
      return "识别中";
    case "downloading":
      return "下载结果";
    case "done":
      return "完成";
    case "failed":
      return "失败";
    default:
      return status || "-";
  }
};

const shortName = (name) => {
  if (!name) return "-";
  const base = name.replace(/\s+/g, " ");
  if (base.length <= 20) return base;
  return `${base.slice(0, 10)}…${base.slice(-6)}`;
};

export default function App() {
  const [category, setCategory] = useState("");
  const [destRoot, setDestRoot] = useState("data/ocr_output");
  const [destinations, setDestinations] = useState([]);
  const [files, setFiles] = useState([]); // supported files only
  const [rejectedFiles, setRejectedFiles] = useState([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [summary, setSummary] = useState(null);
  const [jobId, setJobId] = useState("");
  const [job, setJob] = useState(null);
  const filesInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const applyPickedFiles = (picked) => {
    const all = Array.from(picked || []);
    const ok = [];
    const bad = [];
    for (const f of all) {
      const name = f.name || "";
      const dot = name.lastIndexOf(".");
      const ext = dot >= 0 ? name.slice(dot).toLowerCase() : "";
      if (SUPPORTED_EXTS.has(ext)) ok.push(f);
      else bad.push(f);
    }
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}|${f.size}|${f.lastModified}`));
      const merged = [...prev];
      for (const f of ok) {
        const key = `${f.name}|${f.size}|${f.lastModified}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(f);
        }
      }
      return merged;
    });
    setRejectedFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}|${f.size}|${f.lastModified}`));
      const merged = [...prev];
      for (const f of bad) {
        const key = `${f.name}|${f.size}|${f.lastModified}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(f);
        }
      }
      return merged;
    });
  };

  const fetchDestinations = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/destinations`);
      const data = await res.json();
      setDestRoot(data.root || "data/ocr_output");
      setDestinations(Array.isArray(data.destinations) ? data.destinations : []);
    } catch {
      setDestRoot("data/ocr_output");
      setDestinations([]);
    }
  };

  const fetchSummary = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/summary`);
      const data = await res.json();
      setSummary(data);
    } catch {
      setSummary(null);
    }
  };

  const handleClearOutput = async () => {
    if (!window.confirm("确定要清空 data/ocr_output 下的所有内容吗？此操作不可恢复。")) return;
    try {
      const res = await fetch(`${API_BASE}/api/outputs/clear`, { method: "POST" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "清空失败");
      }
      setMessage("已清空输出目录。");
      fetchSummary();
      fetchDestinations();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "清空失败");
    }
  };

  const handleRefreshSummary = () => {
    fetchSummary();
    fetchDestinations();
  };

  const fetchJob = async (id) => {
    if (!id) return;
    try {
      const res = await fetch(`${API_BASE}/api/jobs/${id}`);
      if (!res.ok) {
        if (res.status === 404) {
          setJob(null);
          setJobId("");
          setMessage("任务已失效或服务已重启，请重新提交。");
        }
        return;
      }
      const data = await res.json();
      setJob(data);
    } catch {
      setJob(null);
    }
  };

  useEffect(() => {
    fetchSummary();
    fetchDestinations();
    const timer = setInterval(() => {
      fetchSummary();
      fetchDestinations();
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!jobId) return;
    fetchJob(jobId);
    const timer = setInterval(() => fetchJob(jobId), 1500);
    return () => clearInterval(timer);
  }, [jobId]);

  useEffect(() => {
    if (!job || !job.files || job.files.length === 0) return;
    const total = job.files.length;
    const done = job.files.filter((f) => f.status === "done").length;
    const failed = job.files.filter((f) => f.status === "failed").length;
    const running = total - done - failed;
    if (running <= 0) {
      setMessage(`任务完成：成功 ${done}，失败 ${failed}`);
      fetchSummary();
    } else {
      setMessage(`处理中：已完成 ${done}/${total}`);
    }
  }, [job]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isUploading) return;

    try {
      if (!files.length) throw new Error("请选择至少 1 个可识别文件");
      // category is optional; empty means save to data/ocr_output root

      setIsUploading(true);
      setMessage("已提交 MinerU OCR 任务，请稍候...");

      const formData = new FormData();
      for (const f of files) formData.append("files", f);
      formData.append("category", category);
      const res = await fetch(`${API_BASE}/api/jobs`, { method: "POST", body: formData });
      const text = await res.text();

      if (!res.ok) {
        throw new Error(text || "OCR 失败");
      }
      const data = JSON.parse(text);
      setJobId(data.job_id);
      const accepted = data.accepted_count ?? files.length;
      const rejected = data.rejected_count ?? 0;
      setMessage(`任务已创建：成功加入 ${accepted}，失败 ${rejected}`);
      setFiles([]);
      setRejectedFiles([]);
      setFileInputKey((k) => k + 1);
      fetchSummary();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "OCR 失败");
    } finally {
      setIsUploading(false);
    }
  };

  const jobFiles = job?.files || [];
  const queuedFiles = jobFiles.filter((f) => f.status === "queued");
  const processingFiles = jobFiles.filter((f) =>
    ["requesting", "uploading", "processing", "downloading"].includes(f.status)
  );
  const doneFiles = jobFiles.filter((f) => f.status === "done");
  const failedFiles = jobFiles.filter((f) => f.status === "failed");

  return (
    <div className="page">
      <div className="topbar">
        <div>
          <h1>HDMS OCR 辅助模块</h1>
          <p className="subtitle">上传资料 → MinerU OCR → 产物落盘到 data/ocr_output</p>
        </div>
        <div className="status">
          {message ? message : "服务运行中"}
        </div>
      </div>

      <div className="grid">
        <section className="card">
          <h2 className="section-title">上传资料 & MinerU OCR</h2>
          <form onSubmit={handleSubmit} className="form">
            <div className="step">
              <div className="step-title">1) 选择待 OCR 的资料（仅 PDF）</div>
              <div className="pick-row">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => folderInputRef.current?.click()}
                >
                  选择文件夹
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => filesInputRef.current?.click()}
                >
                  选择文件
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setFiles([]);
                    setRejectedFiles([]);
                    setFileInputKey((k) => k + 1);
                  }}
                  disabled={!files.length && !rejectedFiles.length}
                >
                  清空
                </button>
              </div>

              {/* Hidden inputs: keep UI clean */}
              <input
                key={`folder-${fileInputKey}`}
                ref={folderInputRef}
                className="hidden-file"
                type="file"
                multiple
                webkitdirectory="true"
                directory="true"
                onChange={(e) => applyPickedFiles(e.target.files)}
              />
              <input
                key={`files-${fileInputKey}`}
                ref={filesInputRef}
                className="hidden-file"
                type="file"
                multiple
                accept=".pdf"
                onChange={(e) => applyPickedFiles(e.target.files)}
              />

              <div className="hint">
                已选择 {files.length + rejectedFiles.length} 个（可上传 {files.length} / 不支持 {rejectedFiles.length}）
                <span className="hint-em">仅支持 PDF</span>
              </div>
            </div>

            <label className="field">
              2) 目标文件夹（可选）
              <select
                className="input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">默认（{destRoot}）</option>
                {destinations.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <div className="actions">
              <button
                className="btn btn-primary"
                type="submit"
                disabled={!files.length || isUploading}
              >
                {isUploading ? "处理中..." : "3) MinerU VLM OCR"}
              </button>
            </div>
          </form>
          {files.length > 0 && (
            <div className="file-list">
              <div className="file-list-title">已选择文件（{files.length}）：</div>
              {files.map((f, idx) => (
                <div key={idx} className="file-list-item">
                  <span className="file-list-name">{f.name}</span>
                  <span className="file-list-size">{(f.size / 1024 / 1024).toFixed(2)} MB</span>
                </div>
              ))}
            </div>
          )}
          {rejectedFiles.length > 0 && (
            <div className="file-list rejected">
              <div className="file-list-title">不支持的文件（{rejectedFiles.length}）：</div>
              {rejectedFiles.map((f, idx) => (
                <div key={idx} className="file-list-item">
                  <span className="file-list-name">{f.name}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="section-title">处理进度</h2>
          <div className="progress-summary">
            <div className="pill">
              待处理：{queuedFiles.length}　处理中：{processingFiles.length}　完成：{doneFiles.length}　失败：{failedFiles.length}
            </div>
          </div>

          <div className="progress-list">
            {!!processingFiles.length && <div className="group-title">处理中（{processingFiles.length}）</div>}
            {processingFiles.map((f) => (
              <div key={f.id} className="progress-item">
                <div className="progress-head">
                  <div className="progress-title">
                    <span className="filename" title={f.file_name}>{shortName(f.file_name)}</span>
                    <span className={`badge badge-${f.status}`}>{statusLabel(f.status)}</span>
                  </div>
                  <div className="percent">{Math.max(0, Math.min(100, f.progress || 0))}%</div>
                </div>
                <div className="bar">
                  <div className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, f.progress || 0))}%` }} />
                </div>
                <div className="progress-meta">
                  <span>文件夹：{f.category || "-"}</span>
                  <span>
                    页数：{f.total_pages || f.pages || "-"} {f.processed_pages ? `(已处理 ${f.processed_pages})` : ""}
                  </span>
                </div>
                {f.error && <div className="error">错误：{f.error}</div>}
              </div>
            ))}

            {!!queuedFiles.length && <div className="group-title">待处理（{queuedFiles.length}）</div>}
            {queuedFiles.map((f) => (
              <div key={f.id} className="progress-item">
                <div className="progress-head">
                  <div className="progress-title">
                    <span className="filename" title={f.file_name}>{shortName(f.file_name)}</span>
                    <span className={`badge badge-${f.status}`}>{statusLabel(f.status)}</span>
                  </div>
                  <div className="percent">0%</div>
                </div>
                <div className="bar">
                  <div className="bar-fill" style={{ width: "0%" }} />
                </div>
                <div className="progress-meta">
                  <span>文件夹：{f.category || "-"}</span>
                  <span>页数：-</span>
                </div>
              </div>
            ))}

            {!!doneFiles.length && <div className="group-title">已完成（{doneFiles.length}）</div>}
            {doneFiles.map((f) => (
              <div key={f.id} className="progress-item">
                <div className="progress-head">
                  <div className="progress-title">
                    <span className="filename" title={f.file_name}>{shortName(f.file_name)}</span>
                    <span className={`badge badge-${f.status}`}>{statusLabel(f.status)}</span>
                  </div>
                  <div className="percent">100%</div>
                </div>
                <div className="bar">
                  <div className="bar-fill" style={{ width: "100%" }} />
                </div>
                <div className="progress-meta">
                  <span>文件夹：{f.category || "-"}</span>
                  <span>页数：{f.pages || f.total_pages || "-"}</span>
                </div>
              </div>
            ))}

            {!!failedFiles.length && <div className="group-title">失败（{failedFiles.length}）</div>}
            {failedFiles.map((f) => (
              <div key={f.id} className="progress-item">
                <div className="progress-head">
                  <div className="progress-title">
                    <span className="filename" title={f.file_name}>{shortName(f.file_name)}</span>
                    <span className={`badge badge-${f.status}`}>{statusLabel(f.status)}</span>
                  </div>
                  <div className="percent">0%</div>
                </div>
                <div className="bar">
                  <div className="bar-fill" style={{ width: "0%" }} />
                </div>
                <div className="progress-meta">
                  <span>文件夹：{f.category || "-"}</span>
                  <span>页数：-</span>
                </div>
                {f.error && <div className="error">错误：{f.error}</div>}
              </div>
            ))}
            {!jobFiles.length && <div className="empty">暂无任务。请在左侧选择多个文件后开始 OCR。</div>}
          </div>
        </section>

        <section className="card">
          <h2 className="section-title">处理结果</h2>

          <div className="stats">
            <div className="stat">
              <div className="stat-label">扫描文件数</div>
              <div className="stat-value">{summary?.total_files ?? 0}</div>
            </div>
            <div className="stat">
              <div className="stat-label">累计页数</div>
              <div className="stat-value">{summary?.total_pages ?? 0}</div>
            </div>
            <div className="stat">
              <div className="stat-label">图片数量</div>
              <div className="stat-value">{summary?.total_images ?? 0}</div>
            </div>
          </div>

          <div className="category-title">按文件夹统计</div>
          <div className="category-list">
            {(summary?.categories || []).map((c) => (
              <div key={c.category} className="category-item">
                <div className="category-name">{c.category}</div>
                <div className="category-meta">
                  <span>{c.total_files} 个文件</span>
                  <span>{c.total_pages} 页</span>
                </div>
              </div>
            ))}
            {summary && (!summary.categories || summary.categories.length === 0) && (
              <div className="empty">暂无 OCR 产物</div>
            )}
          </div>

          <div className="divider" />
          <div className="actions actions-row">
            <button className="btn btn-ghost" type="button" onClick={handleRefreshSummary}>
              一键查询
            </button>
            <button className="btn btn-danger" type="button" onClick={handleClearOutput}>
              一键清空
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
