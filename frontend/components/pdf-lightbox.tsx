"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";
import { ScrollMode, SpecialZoomLevel, Viewer, ViewMode, Worker } from "@react-pdf-viewer/core";
import { defaultLayoutPlugin } from "@react-pdf-viewer/default-layout";
import { searchPlugin, type RenderSearchProps } from "@react-pdf-viewer/search";
import { scrollModePlugin } from "@react-pdf-viewer/scroll-mode";
import { buildPdfSearchCandidates, scheduleAutoPdfHighlight } from "@/lib/pdf-auto-highlight";
import { preserveScrollPositions } from "@/lib/preserve-scroll";
import { highlightAndStayOnPage } from "@/lib/stay-on-page";
import { clearHighlightsPreservingScroll, restoreScrollTop } from "@/lib/pdf-viewer-scroll";

interface PdfLightboxProps {
  src: string;
  onClose: () => void;
  title?: string;
  searchKeyword?: string;
}

const FALLBACK_TITLE = "PDF 预览";
const MIN_PDF_SCALE = 0.1;
const MAX_PDF_SCALE = 4;
const PDF_ZOOM_STEP = 1.1;

const clampScale = (n: number) => Math.max(MIN_PDF_SCALE, Math.min(MAX_PDF_SCALE, n));

type ReadingMode = "continuous" | "singlePage";

function parsePageFromUrl(url: URL): number {
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const params = new URLSearchParams(hash);
  const raw = params.get("page");
  const page = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(page) || page <= 0) return 0;
  return page - 1;
}

function normalizePdfSource(src: string): { fileUrl: string; initialPage: number } {
  try {
    const parsed = new URL(src, typeof window === "undefined" ? "http://localhost" : window.location.origin);
    const initialPage = parsePageFromUrl(parsed);
    parsed.hash = "";

    const apiMatched = parsed.pathname.match(/\/api\/rag\/documents\/([^/]+)\/pdf$/);
    if (apiMatched) {
      return { fileUrl: parsed.toString(), initialPage };
    }

    const matched = parsed.pathname.match(/\/rag\/documents\/([^/]+)\/pdf$/);
    if (matched) {
      const docId = decodeURIComponent(matched[1]);
      return {
        fileUrl: `/api/rag/documents/${encodeURIComponent(docId)}/pdf`,
        initialPage,
      };
    }

    return { fileUrl: parsed.toString(), initialPage };
  } catch {
    return { fileUrl: src, initialPage: 0 };
  }
}

function FullScreenIcon() {
  return <Maximize2 style={{ width: "1rem", height: "1rem" }} />;
}

function SearchSidebarContent(props: RenderSearchProps) {
  return (
    <div style={{ padding: "8px" }}>
      <div style={{ display: "flex", gap: "4px", marginBottom: "8px" }}>
        <input
          type="text"
          placeholder="Search..."
          value={props.keyword}
          onChange={(e) => props.setKeyword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") props.search(); }}
          style={{
            flex: 1,
            padding: "4px 8px",
            border: "1px solid #ccc",
            borderRadius: "4px",
            fontSize: "13px",
          }}
        />
        <button
          type="button"
          onClick={() => props.search()}
          style={{
            padding: "4px 12px",
            border: "1px solid #ccc",
            borderRadius: "4px",
            background: "#f5f5f5",
            cursor: "pointer",
            fontSize: "13px",
          }}
        >
          Search
        </button>
      </div>
      {props.numberOfMatches > 0 && (
        <div style={{ fontSize: "12px", color: "#666", marginBottom: "6px" }}>
          {props.currentMatch} / {props.numberOfMatches} matches
        </div>
      )}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px" }}>
          <input
            type="checkbox"
            checked={props.matchCase}
            onChange={(e) => props.changeMatchCase(e.target.checked)}
          />
          Match case
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "13px" }}>
          <input
            type="checkbox"
            checked={props.wholeWords}
            onChange={(e) => props.changeWholeWords(e.target.checked)}
          />
          Whole words
        </label>
      </div>
    </div>
  );
}

export function PdfLightbox({ src, onClose, title = FALLBACK_TITLE, searchKeyword }: PdfLightboxProps) {
  const { fileUrl, initialPage } = useMemo(() => normalizePdfSource(src), [src]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const currentScaleRef = useRef<number>(1);
  const [readingMode, setReadingMode] = useState<ReadingMode>("continuous");
  const readingModeRef = useRef<ReadingMode>("continuous");
  readingModeRef.current = readingMode;

  const [isFullscreen, setIsFullscreen] = useState(false);
  const isFullscreenRef = useRef(false);
  isFullscreenRef.current = isFullscreen;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Store viewer API for page turning without relying on scroll snapping behavior.
  const viewerApiRef = useRef<{
    jumpToNextPage?: () => Promise<void>;
    jumpToPreviousPage?: () => Promise<void>;
    jumpToPage?: (pageIndex: number) => Promise<void>;
  }>({});

  // Plugin factories can use React hooks internally, so they must be called
  // at the top level of the component (not inside useMemo callbacks).
  const searchPluginInstance = searchPlugin();
  const { Search, clearHighlights, highlight, setTargetPages } = searchPluginInstance;
  const clearHighlightsRef = useRef(clearHighlights);
  clearHighlightsRef.current = clearHighlights;
  const highlightRef = useRef(highlight);
  highlightRef.current = highlight;
  const setTargetPagesRef = useRef(setTargetPages);
  setTargetPagesRef.current = setTargetPages;
  const hasTriggeredSearchRef = useRef(false);
  const [documentLoaded, setDocumentLoaded] = useState(false);
  const [textLayerReady, setTextLayerReady] = useState(false);
  const autoHighlightCleanupRef = useRef<(() => void) | null>(null);
  const normalizedSearchKeyword = (searchKeyword ?? "").trim();

  const requestClose = () => {
    // If we are in fullscreen, exit before closing to avoid a "blank fullscreen" state.
    if (document.fullscreenElement) {
      void document.exitFullscreen().finally(() => onCloseRef.current());
    } else {
      onCloseRef.current();
    }
  };

  const toggleFullscreen = () => {
    const el = rootRef.current;
    if (!el) return;

    // Avoid @react-pdf-viewer fullscreen behavior which can navigate in some browsers/extensions.
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen();
    }
  };

  const layoutPlugin = defaultLayoutPlugin({
    toolbarPlugin: {
      zoomPlugin: { enableShortcuts: false },
    },
    sidebarTabs: (defaultTabs) => {
      const filtered = defaultTabs.filter((tab) => tab.title !== "Attachment");
      return [
        ...filtered,
        {
          content: <Search>{(renderProps) => <SearchSidebarContent {...renderProps} />}</Search>,
          icon: (
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          ),
          title: "Search",
        },
      ];
    },
    renderToolbar: (Toolbar) => (
      <Toolbar>
        {(slots) => {
          const {
            CurrentPageInput,
            GoToNextPage,
            GoToPreviousPage,
            NumberOfPages,
            Zoom,
            ZoomIn,
            ZoomOut,
          } = slots;

          const modeLabel = readingModeRef.current === "continuous" ? "连续" : "单页";
          const fsLabel = isFullscreenRef.current ? "退出全屏" : "全屏";

          return (
            <div
              className="rpv-toolbar"
              role="toolbar"
              aria-orientation="horizontal"
              style={{ display: "flex", alignItems: "center", width: "100%" }}
            >
              {/* Page navigation */}
              <div style={{ display: "flex", alignItems: "center", padding: "0 2px" }}>
                <GoToPreviousPage />
                <CurrentPageInput />
                <span style={{ padding: "0 4px" }}>/</span>
                <NumberOfPages />
                <GoToNextPage />
              </div>
              <div style={{ width: "1px", height: "24px", background: "#e0e0e0", margin: "0 4px" }} />
              {/* Zoom: out, in, percentage */}
              <div style={{ display: "flex", alignItems: "center", padding: "0 2px" }}>
                <ZoomOut />
                <ZoomIn />
                <Zoom levels={[0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 3, 4]} />
              </div>
              <div style={{ width: "1px", height: "24px", background: "#e0e0e0", margin: "0 4px" }} />

              {/* Reading mode toggle */}
              <div style={{ display: "flex", alignItems: "center", padding: "0 2px" }}>
                <button
                  type="button"
                  onClick={() =>
                    setReadingMode((m) => (m === "continuous" ? "singlePage" : "continuous"))
                  }
                  title="切换阅读模式"
                  style={{
                    border: "1px solid #ddd",
                    background: "#fff",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    fontSize: "12px",
                    height: "24px",
                  }}
                >
                  {modeLabel}
                </button>
              </div>

              {/* Fullscreen */}
              <div style={{ display: "flex", alignItems: "center", padding: "0 2px" }}>
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "4px",
                    borderRadius: "4px",
                  }}
                  onClick={toggleFullscreen}
                  title={fsLabel}
                >
                  {isFullscreenRef.current ? (
                    <Minimize2 style={{ width: "1rem", height: "1rem" }} />
                  ) : (
                    <FullScreenIcon />
                  )}
                </button>
              </div>

              {/* Close button pushed to the right */}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", padding: "0 4px" }}>
                <button
                  type="button"
                  onClick={() => {
                    requestClose();
                  }}
                  title={title}
                  aria-label="关闭 PDF 预览"
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "4px",
                    borderRadius: "4px",
                  }}
                >
                  <X style={{ width: "1rem", height: "1rem" }} />
                </button>
              </div>
            </div>
          );
        }}
      </Toolbar>
    ),
  });

  const scrollModePluginInstance = scrollModePlugin();
  const { switchScrollMode } = scrollModePluginInstance;
  const zoomToRef = useRef<(scale: number | SpecialZoomLevel) => void>(() => {});
  zoomToRef.current = layoutPlugin.toolbarPluginInstance?.zoomPluginInstance?.zoomTo ?? (() => {});

  const scaleSyncPlugin = useMemo(
    () => ({
      onTextLayerRender: (props: { ele: HTMLElement; scale: number }) => {
        if (!props?.ele || !Number.isFinite(props.scale)) return;
        const safeScale = props.scale === 0 ? 1e-7 : props.scale;
        props.ele.style.setProperty("--scale-factor", String(safeScale));
        props.ele.parentElement?.style.setProperty("--scale-factor", String(safeScale));
        const viewerRoot = props.ele.closest(".rpv-core__viewer") as HTMLElement | null;
        viewerRoot?.style.setProperty("--scale-factor", String(safeScale));

        // Signal that text layer is ready for search
        setTextLayerReady(true);
      },
    }),
    []
  );

  useEffect(() => {
    // Keep viewer scroll mode in sync with reading mode.
    const next = readingMode === "continuous" ? ScrollMode.Vertical : ScrollMode.Page;
    switchScrollMode(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to user toggling readingMode
  }, [readingMode]);

  // NOTE: We intentionally do NOT toggle document/body styles here.
  // Our app uses nested scroll containers (chat panels), and mutating <body>
  // can still cause reflow/scroll anchoring issues. We instead rely on CSS
  // `overscroll-behavior: contain` on the lightbox root to prevent scroll chaining.

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.ctrlKey || e.metaKey || e.altKey)) {
        e.preventDefault();
        e.stopPropagation();
        requestClose();
        return;
      }

      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key;
      if (key === "-" || key === "_") {
        e.preventDefault();
        e.stopPropagation();
        zoomToRef.current(clampScale(currentScaleRef.current / PDF_ZOOM_STEP));
      } else if (key === "+" || key === "=") {
        e.preventDefault();
        e.stopPropagation();
        zoomToRef.current(clampScale(currentScaleRef.current * PDF_ZOOM_STEP));
      } else if (key === "0") {
        e.preventDefault();
        e.stopPropagation();
        zoomToRef.current(1);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    // React's onWheel handler can be passive; use a native listener so Ctrl/Meta+wheel can reliably prevent browser zoom.
    const el = rootRef.current;
    if (!el) return;

    const wheelAccumRef = { value: 0 };
    const wheelTsRef = { value: 0 };
    const lastTurnTsRef = { value: 0 };
    const TURN_THRESHOLD = 80; // typical mouse wheels are ~100; trackpads send smaller deltas
    const TURN_THROTTLE_MS = 260;

    const onWheel = (e: WheelEvent) => {
      const dialog = dialogRef.current;
      const targetNode = e.target instanceof Node ? e.target : null;
      const isInsideDialog = Boolean(dialog && targetNode && dialog.contains(targetNode));

      // Block wheel scrolling the underlying chat/app when the pointer is outside the dialog.
      if (!isInsideDialog) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // If the wheel happens over non-scrollable parts of the dialog (toolbar chrome),
      // prevent it from "falling through" and scrolling the app underneath.
      const targetEl = e.target instanceof Element ? e.target : null;
      const isInsideViewer = Boolean(
        targetEl?.closest(".rpv-default-layout__body, .rpv-core__inner-pages, .rpv-core__viewer")
      );

      // Single-page mode: treat wheel as page up/down.
      // We do this explicitly because rpv "ScrollMode.Page" still scrolls within the container
      // and doesn't guarantee "one wheel gesture -> one page".
      if (readingModeRef.current === "singlePage" && !(e.ctrlKey || e.metaKey)) {
        if (!isInsideViewer) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        // Ignore pure horizontal scrolling.
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        const now = performance.now();
        if (now - lastTurnTsRef.value < TURN_THROTTLE_MS) return;

        // Reset accumulation if the gesture paused.
        if (now - wheelTsRef.value > 180) wheelAccumRef.value = 0;
        wheelTsRef.value = now;

        wheelAccumRef.value += e.deltaY;
        if (Math.abs(wheelAccumRef.value) < TURN_THRESHOLD) return;

        const dir = wheelAccumRef.value > 0 ? 1 : -1;
        wheelAccumRef.value = 0;
        lastTurnTsRef.value = now;

        const api = viewerApiRef.current;
        if (dir > 0) {
          void api.jumpToNextPage?.();
        } else {
          void api.jumpToPreviousPage?.();
        }
        return;
      }

      if (!(e.ctrlKey || e.metaKey)) {
        if (!isInsideViewer) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const next =
        e.deltaY > 0
          ? currentScaleRef.current / PDF_ZOOM_STEP
          : currentScaleRef.current * PDF_ZOOM_STEP;
      zoomToRef.current(clampScale(next));
    };

    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => el.removeEventListener("wheel", onWheel, true);
  }, []);

  useEffect(() => {
    // Preserve scroll positions of our chat/source scroll containers while the modal is open.
    // This avoids "jumping" caused by browser scroll anchoring + layout changes on mount/unmount.
    const restore = preserveScrollPositions({ selector: ".qa-scrollbar" });
    const prevActive = document.activeElement as HTMLElement | null;

    // Focus the dialog to reduce accidental focus changes while interacting.
    // `preventScroll` is critical to avoid scroll jumps when focusing elements inside scroll containers.
    requestAnimationFrame(() => {
      try {
        dialogRef.current?.focus({ preventScroll: true });
      } catch {
        // Ignore: older browsers may not support preventScroll.
        dialogRef.current?.focus();
      }
    });

    return () => {
      restore();
      // Restore focus without scrolling the chat container.
      try {
        if (prevActive && document.contains(prevActive)) {
          prevActive.focus({ preventScroll: true });
        }
      } catch {
        try {
          prevActive?.focus();
        } catch {
          // noop
        }
      }
    };
  }, []);

  useEffect(() => {
    // Reset state when either the PDF (fileUrl/initialPage) or keyword changes.
    // IMPORTANT: Do not depend on plugin function identities in this effect, or we can create a render loop.
    hasTriggeredSearchRef.current = false;
    autoHighlightCleanupRef.current?.();
    autoHighlightCleanupRef.current = null;

    setDocumentLoaded(false);
    setTextLayerReady(false);

    // Clear any prior highlights and reset page filter.
    clearHighlightsRef.current();
    if (normalizedSearchKeyword) {
      const pageWindowStart = Math.max(0, initialPage - 1);
      const pageWindowEnd = initialPage + 1;
      setTargetPagesRef.current(({ pageIndex }) => pageIndex >= pageWindowStart && pageIndex <= pageWindowEnd);
    } else {
      setTargetPagesRef.current(() => true);
    }
  }, [fileUrl, initialPage, normalizedSearchKeyword]);

  // Auto-search and highlight when searchKeyword is provided.
  useEffect(() => {
    if (!normalizedSearchKeyword) return;

    const candidates = buildPdfSearchCandidates({ quote: normalizedSearchKeyword });
    if (!documentLoaded || candidates.length === 0 || hasTriggeredSearchRef.current) return;

    autoHighlightCleanupRef.current?.();

    const pageWindowStart = Math.max(0, initialPage - 1);
    const pageWindowEnd = initialPage + 1;

    setTargetPagesRef.current(({ pageIndex }) => pageIndex >= pageWindowStart && pageIndex <= pageWindowEnd);

    autoHighlightCleanupRef.current = scheduleAutoPdfHighlight({
      candidates,
      delayMs: textLayerReady ? 1200 : 2000,
      clearAfterMs: 5000,
      clearHighlights: () => {
        const viewerEl = dialogRef.current?.querySelector(".rpv-core__inner-pages") as HTMLElement | null;
        // Don't call jumpToPage() here; it can cause a visible "nudge" when highlights end.
        clearHighlightsPreservingScroll({
          viewerEl,
          clearHighlights: () => clearHighlightsRef.current(),
          frames: 2,
        });
      },
      highlight: async (keyword) => {
        // The search plugin's highlight() internally calls jumpToMatch which
        // scrolls to the first result. We must save and restore scroll position
        // to keep the viewer on the correct (initial) page.
        const viewerEl = dialogRef.current?.querySelector(".rpv-core__inner-pages") as HTMLElement | null;
        const savedTop = viewerEl?.scrollTop;

        const matches = await highlightAndStayOnPage({
          keyword,
          highlight: (kw) => highlightRef.current(kw),
          jumpToPage: (pageIndex) => viewerApiRef.current.jumpToPage?.(pageIndex),
          stayOnPageIndex: initialPage,
        });

        // Restore scroll position after highlight to undo any auto-jump.
        restoreScrollTop(viewerEl, savedTop, 2);
        return matches;
      },
      onMatched: (keyword, matchCount) => {
        hasTriggeredSearchRef.current = true;
        console.log("PDF auto-search matched:", { keyword, matchCount, textLayerReady });
      },
      onNotMatched: () => {
        // Keep manual search available if automatic matching fails.
        setTargetPagesRef.current(() => true);
        console.warn("PDF auto-search found no matches", { candidates });
      },
    });

    return () => {
      autoHighlightCleanupRef.current?.();
      autoHighlightCleanupRef.current = null;
    };
  }, [documentLoaded, initialPage, normalizedSearchKeyword, textLayerReady]);

  return (
    <div
      ref={rootRef}
      className="pdf-lightbox-root fixed inset-0 z-50"
    >
      {/* Backdrop: keep HDMS visible but block interaction */}
      <div
        className={`absolute inset-0 ${isFullscreen ? "bg-black/0 backdrop-blur-0" : "bg-black/15 backdrop-blur-[1px]"}`}
        aria-hidden="true"
        onClick={requestClose}
      />

      {/* Floating window */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={
          isFullscreen
            ? "pdf-lightbox-dialog absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-white shadow-2xl"
            : "pdf-lightbox-dialog absolute left-8 right-8 top-6 bottom-6 flex min-h-0 flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-1 min-h-0 overflow-hidden">
          <Worker workerUrl="/pdf.worker.min.js">
            <Viewer
              key={`${fileUrl}::${initialPage}`}
              fileUrl={fileUrl}
              initialPage={initialPage}
              defaultScale={1}
              scrollMode={readingMode === "continuous" ? ScrollMode.Vertical : ScrollMode.Page}
              viewMode={ViewMode.SinglePage}
              onDocumentLoad={() => {
                setDocumentLoaded(true);
                console.log("PDF document loaded");
              }}
              onZoom={({ scale }) => {
                if (Number.isFinite(scale)) {
                  currentScaleRef.current = scale;
                  const safeScale = scale === 0 ? 1e-7 : scale;
                  rootRef.current?.style.setProperty("--scale-factor", String(safeScale));
                }
              }}
              plugins={[
                // Capture viewer API for wheel-based page turning in single-page mode
                {
                  install: (pluginFunctions) => {
                    viewerApiRef.current.jumpToNextPage = pluginFunctions.jumpToNextPage;
                    viewerApiRef.current.jumpToPreviousPage = pluginFunctions.jumpToPreviousPage;
                    viewerApiRef.current.jumpToPage = pluginFunctions.jumpToPage;
                  },
                },
                layoutPlugin,
                scrollModePluginInstance,
                scaleSyncPlugin,
                searchPluginInstance,
              ]}
            />
          </Worker>
        </div>
      </div>
    </div>
  );
}
