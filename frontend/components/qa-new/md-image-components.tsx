/**
 * QA Markdown 图片渲染组件
 * 独立模块：图片 src 解析、灯箱点击、加载失败降级。
 */
import type { Components } from "react-markdown";
import { API_BASE, QA_API_BASE, normalizeApiBase } from "@/lib/api-base";

/** Resolve image src: convert relative /rag/... paths to absolute URLs */
export function resolveImageSrc(src: string): string {
  if (!src) return src;
  if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
    return src;
  }
  if (src.startsWith("/api/")) return src;
  if (/^\/rag\/documents\/[^/?#]+\/image(?:\?|$)/i.test(src)) {
    return `/api${src}`;
  }
  const base = src.startsWith("/rag/")
    ? normalizeApiBase(QA_API_BASE)
    : normalizeApiBase(API_BASE);
  return src.startsWith("/") ? `${base}${src}` : `${base}/${src}`;
}

export function buildImageComponent(
  onImageClick?: (src: string) => void,
): NonNullable<Components["img"]> {
  const ImageComponent = (props: React.ComponentProps<"img">) => {
    const resolved = resolveImageSrc(typeof props.src === "string" ? props.src : "");
    return (
      <img
        src={resolved}
        alt={props.alt ?? "参考图片"}
        className="qa-figure-image my-4 max-h-80 w-auto max-w-full cursor-zoom-in rounded-xl border border-slate-200/90 bg-white object-contain shadow-[0_12px_28px_rgba(15,23,42,0.08)] transition-[opacity,transform,box-shadow] duration-200 hover:opacity-95 hover:shadow-[0_16px_32px_rgba(15,23,42,0.12)] dark:border-border dark:bg-background dark:shadow-none"
        loading="lazy"
        onClick={() => onImageClick?.(resolved)}
        onError={(e) => {
          const img = e.target as HTMLImageElement;
          img.removeAttribute("src");
          img.alt = "图片暂不可用";
          img.title = "参考图片暂不可用";
          img.style.cursor = "default";
          img.className = "qa-figure-image my-4 flex h-20 w-full items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 text-xs text-muted-foreground shadow-none";
        }}
      />
    );
  };
  return ImageComponent;
}
