"use client";
import { useEffect, useState } from "react";
import { PdfLightbox } from "@/components/pdf-lightbox";
import { resolvePdfUrlForSource } from "@/lib/resolve-pdf-url";
import type { SourceInfo } from "@/features/qa/types";

const report = (m: string) =>
  fetch("/api/zzdiag", { method: "POST", body: m }).catch(() => {});

export default function PdfTestPage() {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    window.addEventListener("error", (e) => report("WINDOW_ERROR " + e.message));
    window.addEventListener("unhandledrejection", (e) =>
      report("UNHANDLED " + ((e as PromiseRejectionEvent).reason?.message ?? "")));

    (async () => {
      const which = new URLSearchParams(window.location.search).get("set") || "final_sources";
      const idx = Number(new URLSearchParams(window.location.search).get("i") || "0");
      const data = await (await fetch("/zzsources.json")).json();
      const sources: SourceInfo[] = data[which] || [];
      report(`SET=${which} count=${sources.length} idx=${idx}`);
      const s = sources[idx];
      if (!s) { report("NO_SOURCE_AT_INDEX"); return; }
      report(`SOURCE label=${s.citation_label} doc_id=${s.doc_id} pdf_url=${s.pdf_url} page=${s.page}`);
      const url = await resolvePdfUrlForSource(s, { preferredPage: s.page, query: "高强度片区的界定标准" });
      report("RESOLVED_URL=" + String(url));
      if (!url) { report("RESULT=FAIL_NO_URL"); return; }
      const probe = await fetch(url.split("#")[0], { method: "GET", headers: { Range: "bytes=0-99" } })
        .then((r) => `${r.status} ${r.headers.get("content-type")}`)
        .catch((e) => "fetch_err " + e.message);
      report("URL_PROBE=" + probe);
      setSrc(url);
    })();

    const iv = setInterval(() => {
      report(`PROBE canvas=${document.querySelectorAll("canvas").length} textLayer=${document.querySelectorAll(".rpv-core__text-layer").length} docError=${JSON.stringify((document.querySelector(".rpv-core__doc-error")?.textContent || "").slice(0,200))}`);
    }, 5000);
    return () => clearInterval(iv);
  }, []);

  if (!src) return <div>resolving...</div>;
  return <PdfLightbox src={src} onClose={() => {}} />;
}
