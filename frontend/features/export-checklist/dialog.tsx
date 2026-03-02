"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, Sparkles, Camera, CheckSquare, Square, SquareX, Minus, Plus } from "lucide-react";
import html2canvas from "html2canvas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useExportChecklistStore } from "./store";
import { exportChecklistPdf, generateAISuggestions } from "./api";
import { convertResultToStats } from "./utils";
import type { FeatureChecklistItem, DetailedStatistics } from "./types";
import {
  decreasePreviewZoom,
  increasePreviewZoom,
  PREVIEW_ZOOM_DEFAULT,
  PREVIEW_ZOOM_MAX,
  PREVIEW_ZOOM_MIN,
  resetPreviewZoom,
} from "./preview-zoom";
import { getSummaryTextClass } from "./summary-status";
import {
  hideAllReviewToolVisuals,
  showOnlyReviewToolVisuals,
} from "@/lib/review-visual-controls";
import { resolveChecklistFeatureStatus, type ToolRunStatus } from "@/lib/tool-view-state";

type CaptureViewKey = "northeast" | "northwest";
type CaptureScreenshots = Record<CaptureViewKey, string | null>;

const CAPTURE_VIEWS: Array<{ key: CaptureViewKey; label: string; buttonTitle: string }> = [
  { key: "northeast", label: "东北视角", buttonTitle: "东北视角" },
  { key: "northwest", label: "西北视角", buttonTitle: "西北视角" },
];

const PLACEHOLDER_HINT = "点击“一键加载审查项截图”生成可视化结果；未生成截图时，导出 PDF 不显示可视化结果。";
const UNSUPPORTED_COLOR_FN_PATTERN = /(?:oklch|oklab)\([^)]*\)/gi;
const AI_PARALLEL_LIMIT = 4;
const CAPTURE_IMAGE_TYPE = "image/jpeg";
const CAPTURE_IMAGE_QUALITY = 0.9;
const CAPTURE_BACKGROUND_COLOR = "#ffffff";
const CAPTURE_MAX_WIDTH = 960;
const CAPTURE_MAX_HEIGHT = 540;
const SCENE_SWITCH_MIN_WAIT_MS = 180;
const HIGHLIGHT_SWITCH_MIN_WAIT_MS = 60;
const OVERLAY_STABLE_MIN_WAIT_MS = 70;
const SCENE_STABLE_MAX_WAIT_MS = 900;
const OVERLAY_STABLE_MAX_WAIT_MS = 420;
const SCENE_STABLE_REQUIRED_FRAMES = 2;
const SCENE_HASH_SAMPLE_SIZE = 16;

let sceneHashCanvas: HTMLCanvasElement | null = null;

function containsUnsupportedColorFunction(value: string) {
  return /(?:oklch|oklab)\(/i.test(value);
}

function copyComputedStyles(sourceEl: HTMLElement, targetEl: HTMLElement) {
  const computedStyle = window.getComputedStyle(sourceEl);
  for (let index = 0; index < computedStyle.length; index += 1) {
    const propertyName = computedStyle[index];
    const propertyValue = computedStyle.getPropertyValue(propertyName);
    const propertyPriority = computedStyle.getPropertyPriority(propertyName);
    if (!propertyValue) continue;
    targetEl.style.setProperty(propertyName, propertyValue, propertyPriority);
  }
}

function cloneElementWithInlineStyles(sourceEl: HTMLElement) {
  const clonedRoot = sourceEl.cloneNode(true) as HTMLElement;
  const sourceElements = [sourceEl, ...Array.from(sourceEl.querySelectorAll<HTMLElement>("*"))];
  const clonedElements = [clonedRoot, ...Array.from(clonedRoot.querySelectorAll<HTMLElement>("*"))];
  sourceElements.forEach((sourceNode, index) => {
    const clonedNode = clonedElements[index];
    if (!clonedNode) return;
    copyComputedStyles(sourceNode, clonedNode);
  });
  return clonedRoot;
}

function getSceneCaptureRoot() {
  const sceneRoot = document.querySelector("[data-scene-capture-root]");
  if (!(sceneRoot instanceof HTMLElement)) {
    throw new Error("未找到 3D 场景容器，请确保模型场景已加载");
  }
  return sceneRoot;
}

function getSceneCanvas(sceneRoot: HTMLElement) {
  const canvas = sceneRoot.querySelector("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error("未找到 3D 场景，请确保模型已加载");
  }
  return canvas;
}

function getOverlayRoots(sceneRoot: HTMLElement) {
  return Array.from(sceneRoot.children).filter(
    (child): child is HTMLElement => child instanceof HTMLElement && child.tagName !== "CANVAS"
  );
}

function getCaptureScale(sceneRoot: HTMLElement) {
  const sceneWidth = Math.max(1, sceneRoot.clientWidth || 1);
  const sceneHeight = Math.max(1, sceneRoot.clientHeight || 1);
  const widthScale = CAPTURE_MAX_WIDTH / sceneWidth;
  const heightScale = CAPTURE_MAX_HEIGHT / sceneHeight;
  return Math.max(0.1, Math.min(1, widthScale, heightScale));
}

function createOverlaySnapshotWrapper(
  sceneRoot: HTMLElement,
  width: number,
  height: number,
  overlayRoots: HTMLElement[] = getOverlayRoots(sceneRoot)
) {
  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.left = "-100000px";
  wrapper.style.top = "0";
  wrapper.style.width = `${width}px`;
  wrapper.style.height = `${height}px`;
  wrapper.style.overflow = "hidden";
  wrapper.style.pointerEvents = "none";
  wrapper.style.background = "transparent";

  overlayRoots.forEach((overlayRoot) => {
    wrapper.appendChild(cloneElementWithInlineStyles(overlayRoot));
  });

  return wrapper;
}

async function captureOverlayLayerCanvas(sceneRoot: HTMLElement, width: number, height: number) {
  const overlayRoots = getOverlayRoots(sceneRoot);
  if (overlayRoots.length === 0) {
    return null;
  }

  try {
    return await html2canvas(sceneRoot, {
      backgroundColor: null,
      scale: 1,
      width,
      height,
      useCORS: true,
      logging: false,
      ignoreElements: (element) => element.tagName === "CANVAS",
      onclone: (clonedDocument) => {
        sanitizeUnsupportedColorFunctions(clonedDocument);
      },
    });
  } catch (error) {
    console.warn("直接截图可视化标签层失败，回退到内联样式模式", error);
  }

  const wrapper = createOverlaySnapshotWrapper(sceneRoot, width, height, overlayRoots);
  if (wrapper.childElementCount === 0) {
    return null;
  }

  document.body.appendChild(wrapper);
  try {
    return await html2canvas(wrapper, {
      backgroundColor: null,
      scale: 1,
      width,
      height,
      useCORS: true,
      logging: false,
      onclone: (clonedDocument) => {
        // 清掉全局样式，避免 html2canvas 解析 Tailwind oklch 时崩溃；overlay 已内联样式。
        clonedDocument.querySelectorAll("style, link[rel='stylesheet']").forEach((node) => {
          node.remove();
        });
      },
    });
  } finally {
    wrapper.remove();
  }
}

async function captureSceneRootDataUrl(sceneRoot: HTMLElement, scale: number) {
  const sceneCanvas = getSceneCanvas(sceneRoot);
  const width = Math.max(1, Math.round((sceneCanvas.clientWidth || sceneRoot.clientWidth || sceneCanvas.width) * scale));
  const height = Math.max(1, Math.round((sceneCanvas.clientHeight || sceneRoot.clientHeight || sceneCanvas.height) * scale));
  const sceneSnapshot = await html2canvas(sceneRoot, {
    backgroundColor: CAPTURE_BACKGROUND_COLOR,
    scale,
    width,
    height,
    useCORS: true,
    logging: false,
    onclone: (clonedDocument) => {
      sanitizeUnsupportedColorFunctions(clonedDocument);
    },
  });
  return canvasToDataUrl(sceneSnapshot, CAPTURE_IMAGE_TYPE, CAPTURE_IMAGE_QUALITY);
}

function sanitizeUnsupportedColorFunctions(clonedDocument: Document) {
  const replaceUnsupportedColors = (value: string) =>
    value.replace(UNSUPPORTED_COLOR_FN_PATTERN, "rgb(128, 128, 128)");

  clonedDocument.querySelectorAll("style").forEach((styleEl) => {
    const cssText = styleEl.textContent;
    if (!cssText || !containsUnsupportedColorFunction(cssText)) return;
    styleEl.textContent = replaceUnsupportedColors(cssText);
  });

  clonedDocument
    .querySelectorAll<HTMLElement>("[style*='oklch('], [style*='oklab(']")
    .forEach((el) => {
      const inlineStyle = el.getAttribute("style");
      if (!inlineStyle || !containsUnsupportedColorFunction(inlineStyle)) return;
      el.setAttribute("style", replaceUnsupportedColors(inlineStyle));
    });
}

function createEmptyScreenshots(): CaptureScreenshots {
  return {
    northeast: null,
    northwest: null,
  };
}

function getCaption(itemName: string, viewLabel: string) {
  return `${itemName}${viewLabel}检测结果图`;
}

function isSuggestionInvalid(value: string) {
  const normalized = value.trim();
  return (
    normalized.length === 0 ||
    normalized.includes("建议生成失败") ||
    normalized.includes("AI 建议生成失败")
  );
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function getSceneHash(sceneCanvas: HTMLCanvasElement) {
  if (!sceneHashCanvas) {
    sceneHashCanvas = document.createElement("canvas");
    sceneHashCanvas.width = SCENE_HASH_SAMPLE_SIZE;
    sceneHashCanvas.height = SCENE_HASH_SAMPLE_SIZE;
  }
  const sampleCtx = sceneHashCanvas.getContext("2d", { willReadFrequently: true });
  if (!sampleCtx) return null;
  try {
    sampleCtx.clearRect(0, 0, SCENE_HASH_SAMPLE_SIZE, SCENE_HASH_SAMPLE_SIZE);
    sampleCtx.drawImage(sceneCanvas, 0, 0, SCENE_HASH_SAMPLE_SIZE, SCENE_HASH_SAMPLE_SIZE);
    const pixelData = sampleCtx.getImageData(0, 0, SCENE_HASH_SAMPLE_SIZE, SCENE_HASH_SAMPLE_SIZE).data;
    let hash = 2166136261;
    for (let index = 0; index < pixelData.length; index += 16) {
      hash ^= pixelData[index];
      hash = Math.imul(hash, 16777619);
      hash ^= pixelData[index + 1];
      hash = Math.imul(hash, 16777619);
      hash ^= pixelData[index + 2];
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  } catch {
    return null;
  }
}

async function waitForSceneStable(sceneCanvas: HTMLCanvasElement | null, minWaitMs: number) {
  await waitForNextPaint();
  if (!(sceneCanvas instanceof HTMLCanvasElement)) {
    await wait(minWaitMs);
    await waitForNextPaint();
    return;
  }

  const initialHash = getSceneHash(sceneCanvas);
  if (initialHash === null) {
    await wait(minWaitMs);
    await waitForNextPaint();
    return;
  }

  let previousHash = initialHash;
  let stableFrameCount = 0;
  const startTime = performance.now();

  while (performance.now() - startTime < SCENE_STABLE_MAX_WAIT_MS) {
    await waitForNextPaint();
    const currentHash = getSceneHash(sceneCanvas);
    if (currentHash === null) {
      break;
    }

    if (currentHash === previousHash) {
      stableFrameCount += 1;
    } else {
      stableFrameCount = 0;
      previousHash = currentHash;
    }

    if (
      performance.now() - startTime >= minWaitMs &&
      stableFrameCount >= SCENE_STABLE_REQUIRED_FRAMES
    ) {
      break;
    }
  }

  await waitForNextPaint();
}

function getOverlaySignature(sceneRoot: HTMLElement) {
  const overlayRoots = getOverlayRoots(sceneRoot);
  if (overlayRoots.length === 0) return "none";
  return overlayRoots
    .map((root) => {
      const rect = root.getBoundingClientRect();
      const textLength = root.textContent?.trim().length ?? 0;
      return `${root.childElementCount}:${Math.round(rect.width)}x${Math.round(rect.height)}:${textLength}`;
    })
    .join("|");
}

async function waitForOverlayStable(sceneRoot: HTMLElement, minWaitMs: number) {
  let previousSignature = getOverlaySignature(sceneRoot);
  let stableFrameCount = 0;
  const startTime = performance.now();

  while (performance.now() - startTime < OVERLAY_STABLE_MAX_WAIT_MS) {
    await waitForNextPaint();
    const currentSignature = getOverlaySignature(sceneRoot);
    if (currentSignature === previousSignature) {
      stableFrameCount += 1;
    } else {
      previousSignature = currentSignature;
      stableFrameCount = 0;
    }
    if (
      performance.now() - startTime >= minWaitMs &&
      stableFrameCount >= SCENE_STABLE_REQUIRED_FRAMES
    ) {
      break;
    }
  }
}

function switchViewByButtonTitle(buttonTitle: string) {
  const button = document.querySelector(`button[title='${buttonTitle}']`) as HTMLButtonElement | null;
  if (!button) {
    throw new Error(`未找到“${buttonTitle}”按钮，请确认页面处于可截图状态`);
  }
  button.click();
}

function canvasToDataUrl(
  canvas: HTMLCanvasElement,
  imageType: string,
  imageQuality?: number
) {
  return new Promise<string>((resolve, reject) => {
    if (typeof canvas.toBlob !== "function") {
      try {
        resolve(canvas.toDataURL(imageType, imageQuality));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("截图失败：图像编码失败"));
      }
      return;
    }
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("截图失败：图像编码失败"));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            resolve(reader.result);
            return;
          }
          reject(new Error("截图失败：图像读取失败"));
        };
        reader.onerror = () => reject(new Error("截图失败：图像读取失败"));
        reader.readAsDataURL(blob);
      },
      imageType,
      imageQuality
    );
  });
}

async function captureSceneViewportDataUrl(sceneRoot: HTMLElement, sceneCanvas: HTMLCanvasElement) {
  const captureScale = getCaptureScale(sceneRoot);
  try {
    return await captureSceneRootDataUrl(sceneRoot, captureScale);
  } catch (error) {
    console.warn("直接截图场景失败，回退到手动合成模式", error);
  }

  const width = Math.max(
    1,
    Math.round((sceneCanvas.clientWidth || sceneRoot.clientWidth || sceneCanvas.width) * captureScale)
  );
  const height = Math.max(
    1,
    Math.round((sceneCanvas.clientHeight || sceneRoot.clientHeight || sceneCanvas.height) * captureScale)
  );
  const composedCanvas = document.createElement("canvas");
  composedCanvas.width = width;
  composedCanvas.height = height;
  const ctx = composedCanvas.getContext("2d");
  if (!ctx) {
    throw new Error("截图失败：无法创建 2D 合成上下文");
  }

  // 底图来自 WebGL，确保渲染体块与高亮层清晰。
  ctx.fillStyle = CAPTURE_BACKGROUND_COLOR;
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sceneCanvas, 0, 0, width, height);

  try {
    const overlayCanvas = await captureOverlayLayerCanvas(sceneRoot, width, height);
    if (overlayCanvas) {
      ctx.drawImage(overlayCanvas, 0, 0, width, height);
    }
  } catch (error) {
    console.warn("截图标签层合成失败，已保留底图", error);
  }

  return canvasToDataUrl(composedCanvas, CAPTURE_IMAGE_TYPE, CAPTURE_IMAGE_QUALITY);
}

interface ExportChecklistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  features: Array<{
    id: string;
    name: string;
    checked: boolean;
    isPass: boolean;
    summary: string;
    rawResult: unknown;
  }>;
}

export function ExportChecklistDialog({
  open,
  onOpenChange,
  features,
}: ExportChecklistDialogProps) {
  const [aiProgress, setAiProgress] = useState({ completed: 0, total: 0 });
  const [previewZoom, setPreviewZoom] = useState(PREVIEW_ZOOM_DEFAULT);
  const {
    projectName,
    items,
    isGeneratingAI,
    isCapturingScreenshot,
    setProjectName,
    setItems,
    updateItem,
    setIsGeneratingAI,
    setIsCapturingScreenshot,
  } = useExportChecklistStore();

  const pageRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const itemPageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const featuresRef = useRef(features);
  featuresRef.current = features;

  const registerItemPageRef = useCallback((itemId: string, node: HTMLDivElement | null) => {
    if (node) {
      itemPageRefs.current[itemId] = node;
      return;
    }
    delete itemPageRefs.current[itemId];
  }, []);

  const handleJumpToItemPage = useCallback((itemId: string) => {
    const container = previewScrollRef.current;
    const targetPage = itemPageRefs.current[itemId];
    if (!container || !targetPage) return;

    const containerRect = container.getBoundingClientRect();
    const targetRect = targetPage.getBoundingClientRect();
    const nextTop = container.scrollTop + (targetRect.top - containerRect.top) - 16;
    container.scrollTo({ top: Math.max(nextTop, 0), behavior: "smooth" });
  }, []);

  // 初始化数据 — 仅在弹窗打开时触发，通过 ref 读取最新 features 避免引用不稳定问题
  useEffect(() => {
    if (open && featuresRef.current.length > 0) {
      setPreviewZoom(PREVIEW_ZOOM_DEFAULT);
      setAiProgress({ completed: 0, total: 0 });
      const initialItems: FeatureChecklistItem[] = featuresRef.current.map((f) => {
        const detailedStats = convertResultToStats(f.id, f.rawResult);
        return {
          id: f.id,
          name: f.name,
          isPass: f.isPass,
          screenshots: createEmptyScreenshots(),
          summary: f.summary,
          detailedStats,
          rawResult: f.rawResult,
          aiSuggestion: "",
          isGeneratingAI: false,
          aiGenerationStatus: "idle",
          showAiSuggestion: true,
          govSuggestion: "",
        };
      });
      setItems(initialItems);
    }
  }, [open]);

  // 手动截图函数
  const handleCaptureScreenshot = async () => {
    if (items.length === 0) return;

    setIsCapturingScreenshot(true);
    setItems(items.map((item) => ({ ...item, screenshots: createEmptyScreenshots() })));
    const failedCaptures: Array<{ itemName: string; viewLabel: string }> = [];

    try {
      // 让占位符先渲染为加载中，避免用户感知页面“卡住”
      await waitForNextPaint();

      const sceneRoot = getSceneCaptureRoot();
      const sceneCanvas = getSceneCanvas(sceneRoot);
      const capturedMap = new Map(items.map((item) => [item.id, createEmptyScreenshots()]));

      for (const view of CAPTURE_VIEWS) {
        switchViewByButtonTitle(view.buttonTitle);
        await waitForSceneStable(sceneCanvas, SCENE_SWITCH_MIN_WAIT_MS);
        await waitForOverlayStable(sceneRoot, OVERLAY_STABLE_MIN_WAIT_MS);

        for (const item of items) {
          showOnlyReviewToolVisuals(item.id);
          await waitForSceneStable(sceneCanvas, HIGHLIGHT_SWITCH_MIN_WAIT_MS);
          await waitForOverlayStable(sceneRoot, OVERLAY_STABLE_MIN_WAIT_MS);
          try {
            const screenshotDataUrl = await captureSceneViewportDataUrl(sceneRoot, sceneCanvas);
            const captured = capturedMap.get(item.id) ?? createEmptyScreenshots();
            captured[view.key] = screenshotDataUrl;
            capturedMap.set(item.id, captured);
            updateItem(item.id, { screenshots: { ...captured } });
          } catch (error) {
            failedCaptures.push({ itemName: item.name, viewLabel: view.label });
            console.error(`截图失败：${item.name}-${view.label}`, error);
          }
          await waitForNextPaint();
        }
      }
    } catch (error) {
      console.error("截图失败:", error);
      alert(`截图失败: ${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      if (failedCaptures.length > 0) {
        const preview = failedCaptures
          .slice(0, 3)
          .map((entry) => `${entry.itemName}-${entry.viewLabel}`)
          .join("、");
        const tail = failedCaptures.length > 3 ? ` 等 ${failedCaptures.length} 张` : "";
        alert(`部分截图未生成：${preview}${tail}。其余截图已保留。`);
      }
      hideAllReviewToolVisuals();
      setIsCapturingScreenshot(false);
    }
  };

  // 批量生成 AI 建议并直接覆盖“审查方建议”
  const handleGenerateAllAI = async () => {
    if (isGeneratingAI) return;

    const targetItems = [...items];
    if (targetItems.length === 0) {
      return;
    }

    setIsGeneratingAI(true);
    setAiProgress({ completed: 0, total: targetItems.length });
    targetItems.forEach((item) => {
      updateItem(item.id, {
        isGeneratingAI: false,
        aiGenerationStatus: "queued",
      });
    });

    try {
      const failedItems: string[] = [];
      const taskQueue = [...targetItems];
      const workerCount = Math.min(AI_PARALLEL_LIMIT, taskQueue.length);

      const workers = Array.from({ length: workerCount }, () => (async () => {
        while (taskQueue.length > 0) {
          const item = taskQueue.shift();
          if (!item) break;

          updateItem(item.id, {
            isGeneratingAI: true,
            aiGenerationStatus: "generating",
          });

          try {
            const response = await generateAISuggestions({
              features: [{
                id: item.id,
                name: item.name,
                summary: item.summary,
                raw_result: item.rawResult,
              }],
            });

            const matched = response.suggestions.find((suggestion) => suggestion.id === item.id);
            const fallback = response.suggestions[0];
            const suggestionText = (matched?.suggestion ?? fallback?.suggestion ?? "").trim();

            if (isSuggestionInvalid(suggestionText)) {
              failedItems.push(item.name);
              updateItem(item.id, {
                isGeneratingAI: false,
                aiGenerationStatus: "failed",
              });
            } else {
              updateItem(item.id, {
                govSuggestion: suggestionText,
                isGeneratingAI: false,
                aiGenerationStatus: "done",
              });
            }
          } catch (error) {
            console.error(`生成 ${item.name} 建议失败:`, error);
            failedItems.push(item.name);
            updateItem(item.id, {
              isGeneratingAI: false,
              aiGenerationStatus: "failed",
            });
          } finally {
            setAiProgress((prev) => ({ ...prev, completed: prev.completed + 1 }));
          }
        }
      })());

      await Promise.all(workers);

      if (failedItems.length > 0) {
        const preview = failedItems.slice(0, 3).join("、");
        const tail = failedItems.length > 3 ? ` 等 ${failedItems.length} 项` : "";
        alert(`部分项目生成失败：${preview}${tail}，已保留原审查方建议。`);
      }
    } catch (error) {
      console.error("批量生成失败:", error);
      alert(`生成失败: ${error instanceof Error ? error.message : "未知错误"}`);
      targetItems.forEach((item) => {
        updateItem(item.id, {
          isGeneratingAI: false,
          aiGenerationStatus: "failed",
        });
      });
    } finally {
      setIsGeneratingAI(false);
    }
  };

  // 导出 PDF
  const handleExportPDF = async () => {
    if (!pageRef.current) return;

    try {
      // 截取页面内容
      const canvas = await html2canvas(pageRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        onclone: (clonedDocument) => {
          sanitizeUnsupportedColorFunctions(clonedDocument);
        },
      });

      const imgData = canvas.toDataURL("image/png");
      const fileName = `${projectName || "审核清单"}_${new Date().toISOString().slice(0, 10)}`;
      const pdfBlob = await exportChecklistPdf({
        project_name: projectName || "审核清单",
        file_name: fileName,
        image_data_url: imgData,
      });

      const downloadUrl = URL.createObjectURL(pdfBlob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `${fileName}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error("PDF 导出失败:", error);
      alert(`PDF 导出失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] sm:max-w-[90vw] h-[90vh] p-0 flex flex-col z-[2147483647]">
        <DialogHeader className="px-6 py-3 border-b flex flex-row items-center justify-between">
          <DialogTitle>管控审核清单导出</DialogTitle>
          <div className="flex items-center gap-2 mr-8">
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => setPreviewZoom((current) => decreasePreviewZoom(current))}
              disabled={previewZoom <= PREVIEW_ZOOM_MIN}
              aria-label="缩小预览"
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-16 text-center text-sm text-gray-700">{previewZoom}%</span>
            <Button
              type="button"
              variant="outline"
              className="h-9 px-3"
              onClick={() => setPreviewZoom(resetPreviewZoom())}
              disabled={previewZoom === PREVIEW_ZOOM_DEFAULT}
            >
              重置
            </Button>
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={() => setPreviewZoom((current) => increasePreviewZoom(current))}
              disabled={previewZoom >= PREVIEW_ZOOM_MAX}
              aria-label="放大预览"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* 中间栏 - A4 预览 */}
          <MiddlePreview
            projectName={projectName}
            items={items}
            isCapturingScreenshot={isCapturingScreenshot}
            onUpdateGovSuggestion={(id, text) => updateItem(id, { govSuggestion: text })}
            pageRef={pageRef}
            scrollContainerRef={previewScrollRef}
            onRegisterItemPageRef={registerItemPageRef}
            previewZoom={previewZoom}
          />

          {/* 右侧栏 - 功能按钮 */}
          <RightActions
            projectName={projectName}
            onProjectNameChange={setProjectName}
            features={features.map(f => ({
              id: f.id,
              name: f.name,
              status: resolveChecklistFeatureStatus(f.checked, f.isPass),
            }))}
            isCapturingScreenshot={isCapturingScreenshot}
            isGeneratingAI={isGeneratingAI}
            aiProgress={aiProgress}
            onCaptureScreenshot={handleCaptureScreenshot}
            onGenerateAllAI={handleGenerateAllAI}
            onExportPDF={handleExportPDF}
            onJumpToItemPage={handleJumpToItemPage}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// A4 页面样式常量
const A4_STYLE: React.CSSProperties = {
  width: "794px",
  minHeight: "1123px",
  padding: "60px",
  fontFamily: "SimSun, serif",
};

// 中间栏组件 - Word 式分页效果
function MiddlePreview({
  projectName,
  items,
  isCapturingScreenshot,
  onUpdateGovSuggestion,
  pageRef,
  scrollContainerRef,
  onRegisterItemPageRef,
  previewZoom,
}: {
  projectName: string;
  items: FeatureChecklistItem[];
  isCapturingScreenshot: boolean;
  onUpdateGovSuggestion: (id: string, text: string) => void;
  pageRef: React.RefObject<HTMLDivElement | null>;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onRegisterItemPageRef: (itemId: string, node: HTMLDivElement | null) => void;
  previewZoom: number;
}) {
  const date = new Date().toLocaleDateString("zh-CN");
  const previewScale = previewZoom / 100;

  return (
    <div className="flex-1 min-h-0 bg-gray-100 flex flex-col">
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto" style={{ width: `${794 * previewScale}px` }}>
          <div style={{ zoom: previewScale }}>
            {/* 使用 space-y-6 在多个 A4 页面之间创建间隙，模拟 Word 分页效果 */}
            <div ref={pageRef} className="space-y-6" style={{ width: "794px" }}>
              {/* 第 1 页：封面 */}
              <div className="bg-white shadow-lg" style={A4_STYLE}>
                {/* 封面标题 */}
                <div className="text-center mb-6">
                  <h1 className="text-2xl font-bold mb-2">
                    {projectName || "____"}管控审核清单
                  </h1>
                  <p className="text-sm text-gray-600">日期：{date}</p>
                </div>
                <div className="border-t-2 border-gray-800 mb-6" />

                {/* 检测项目录表格 */}
                <div className="mb-6">
                  <h2 className="text-base font-semibold mb-3">检测项目录</h2>
                  {items.length === 0 ? (
                    <div className="text-center text-gray-500 py-8">暂无检测数据</div>
                  ) : (
                    <table className="w-full text-sm border-collapse border border-gray-300">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="border border-gray-300 px-3 py-2 text-left w-12">序号</th>
                          <th className="border border-gray-300 px-3 py-2 text-left">检测项</th>
                          <th className="border border-gray-300 px-3 py-2 text-center w-32">检测结果</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, index) => (
                          <tr key={item.id}>
                            <td className="border border-gray-300 px-3 py-1.5 text-center">{index + 1}</td>
                            <td className="border border-gray-300 px-3 py-1.5">{item.name}</td>
                            <td className={`border border-gray-300 px-3 py-1.5 text-center text-xs ${getSummaryTextClass(
                              item.summary,
                              item.isPass
                            )}`}>
                              {item.summary}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* 第 2~N 页：每个检测项一页 */}
              {items.map((item, index) => (
                <div
                  key={item.id}
                  ref={(node) => onRegisterItemPageRef(item.id, node)}
                  className="bg-white shadow-lg"
                  style={A4_STYLE}
                >
                  {/* 页眉 */}
                  <div className="flex items-center justify-between text-xs text-gray-400 mb-4 pb-2 border-b border-gray-200">
                    <span>{projectName || "____"}管控审核清单</span>
                    <span>第 {index + 2} 页</span>
                  </div>

                  <ChecklistItemDetail
                    item={item}
                    index={index}
                    isCapturingScreenshot={isCapturingScreenshot}
                    onUpdateGovSuggestion={(text) => onUpdateGovSuggestion(item.id, text)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 检测项详情组件
function ChecklistItemDetail({
  item,
  index,
  isCapturingScreenshot,
  onUpdateGovSuggestion,
}: {
  item: FeatureChecklistItem;
  index: number;
  isCapturingScreenshot: boolean;
  onUpdateGovSuggestion: (text: string) => void;
}) {
  const isQueued = item.aiGenerationStatus === "queued";
  const isGenerating = item.aiGenerationStatus === "generating";
  const isFailed = item.aiGenerationStatus === "failed";
  const overlayMessage = isGenerating ? "正在生成建议..." : "待开始，请稍等...";

  return (
    <div className="space-y-3">
      {/* 标题 */}
      <h2 className="text-lg font-semibold">
        {index + 1}. {item.name}
      </h2>

      {/* 双视角渲染图 */}
      <div className="grid grid-cols-2 gap-4">
        {CAPTURE_VIEWS.map((view) => {
          const screenshotUrl = item.screenshots[view.key];
          return (
            <div key={`${item.id}-${view.key}`} className="space-y-1.5">
              <div className="w-full h-[180px] border rounded bg-gray-50 overflow-hidden">
                {screenshotUrl ? (
                  <img
                    src={screenshotUrl}
                    alt={getCaption(item.name, view.label)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center px-4 text-center">
                    {isCapturingScreenshot ? (
                      <>
                        <Loader2 className="h-5 w-5 text-gray-500 animate-spin mb-2" />
                        <p className="text-xs text-gray-500">截图生成中，请稍候...</p>
                      </>
                    ) : (
                      <p className="text-xs text-gray-500 leading-5">
                        {PLACEHOLDER_HINT}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <p className="text-[11px] text-gray-500 text-center">
                {getCaption(item.name, view.label)}
              </p>
            </div>
          );
        })}
      </div>

      {/* 无检测数据时保留摘要 */}
      {!item.detailedStats && (
        <div className="text-xs text-gray-500">
          <p>说明：未检测项不会生成可视化结果图。</p>
        </div>
      )}

      {/* 详细统计 */}
      {item.detailedStats ? (
        <DetailedStatisticsView stats={item.detailedStats} />
      ) : (
        <div className="text-sm text-gray-700 pl-4">
          <p>{item.summary}</p>
        </div>
      )}

      {/* 审查方建议 */}
      <div className="space-y-2">
        <label className="text-sm font-medium">审查方建议：</label>
        <div className="relative">
          <Textarea
            value={item.govSuggestion}
            onChange={(e) => onUpdateGovSuggestion(e.target.value)}
            disabled={isQueued || isGenerating}
            placeholder={
              isGenerating
                ? "正在生成建议..."
                : isQueued
                ? "待开始，请稍等..."
                : "请输入审查方建议..."
            }
            className="min-h-[80px] text-sm"
          />
          {(isQueued || isGenerating) && (
            <div className="absolute inset-0 rounded-md bg-white/75 flex items-center justify-center pointer-events-none">
              <span className="inline-flex items-center text-sm text-gray-600">
                <Loader2 className={`h-4 w-4 mr-2 ${isGenerating ? "animate-spin" : "animate-pulse"}`} />
                <span className="animate-pulse">{overlayMessage}</span>
              </span>
            </div>
          )}
        </div>
        {isFailed && (
          <p className="text-xs text-red-500">生成失败，请重试一键填充。</p>
        )}
      </div>
    </div>
  );
}

// 详细统计展示组件 — 表格形式
function DetailedStatisticsView({ stats }: { stats: DetailedStatistics }) {
  const hasPassedPlots = stats.passed.plots.length > 0;
  const hasFailedItems = stats.failed.items.length > 0;

  // 如果既没有通过也没有不通过的详细数据，只显示 summary
  if (!hasPassedPlots && !hasFailedItems && stats.passed.totalBuildings === 0 && stats.failed.totalBuildings === 0) {
    return (
      <div className="text-sm">
        <p className="text-gray-600">{stats.summary}</p>
      </div>
    );
  }

  return (
    <div className="text-sm space-y-3">
      {/* 通过项表格 */}
      {(hasPassedPlots || stats.passed.totalBuildings > 0) && (
        <div>
          <p className="font-medium text-green-700 mb-1">通过项（{stats.passed.totalBuildings} 栋）</p>
          {hasPassedPlots ? (
            <table className="w-full border-collapse border border-gray-300">
              <thead>
                <tr className="bg-green-50">
                  <th className="border border-gray-300 px-2 py-1 text-left w-10">序号</th>
                  <th className="border border-gray-300 px-2 py-1 text-left">地块</th>
                  <th className="border border-gray-300 px-2 py-1 text-left">建筑</th>
                </tr>
              </thead>
              <tbody>
                {stats.passed.plots.map((plot, idx) => (
                  <tr key={idx}>
                    <td className="border border-gray-300 px-2 py-1 text-center">{idx + 1}</td>
                    <td className="border border-gray-300 px-2 py-1">{plot.name}</td>
                    <td className="border border-gray-300 px-2 py-1">{plot.buildings.join("、")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-gray-600 text-xs">共 {stats.passed.totalBuildings} 项通过</p>
          )}
        </div>
      )}

      {/* 不通过项表格 */}
      {(hasFailedItems || stats.failed.totalBuildings > 0) && (
        <div>
          <p className="font-medium text-red-700 mb-1">不通过项（{stats.failed.totalBuildings} 栋）</p>
          {hasFailedItems ? (
            <table className="w-full border-collapse border border-gray-300">
              <thead>
                <tr className="bg-red-50">
                  <th className="border border-gray-300 px-2 py-1 text-left w-10">序号</th>
                  <th className="border border-gray-300 px-2 py-1 text-left">地块</th>
                  <th className="border border-gray-300 px-2 py-1 text-left">建筑/对象</th>
                  <th className="border border-gray-300 px-2 py-1 text-left">问题</th>
                  <th className="border border-gray-300 px-2 py-1 text-left">详情</th>
                </tr>
              </thead>
              <tbody>
                {stats.failed.items.map((item, idx) => (
                  <tr key={idx}>
                    <td className="border border-gray-300 px-2 py-1 text-center">{idx + 1}</td>
                    <td className="border border-gray-300 px-2 py-1">{item.plotName}</td>
                    <td className="border border-gray-300 px-2 py-1">{item.buildingName}</td>
                    <td className="border border-gray-300 px-2 py-1">{item.issue}</td>
                    <td className="border border-gray-300 px-2 py-1 text-xs">{item.details || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-gray-600 text-xs">共 {stats.failed.totalBuildings} 项不通过</p>
          )}
        </div>
      )}

      {/* 总计 */}
      <div className="bg-gray-50 px-3 py-2 rounded text-gray-700 font-medium">
        {stats.summary}
      </div>
    </div>
  );
}

// 右侧功能按钮区
function RightActions({
  projectName,
  onProjectNameChange,
  features,
  isCapturingScreenshot,
  isGeneratingAI,
  aiProgress,
  onCaptureScreenshot,
  onGenerateAllAI,
  onExportPDF,
  onJumpToItemPage,
}: {
  projectName: string;
  onProjectNameChange: (name: string) => void;
  features: Array<{ id: string; name: string; status: ToolRunStatus }>;
  isCapturingScreenshot: boolean;
  isGeneratingAI: boolean;
  aiProgress: { completed: number; total: number };
  onCaptureScreenshot: () => void;
  onGenerateAllAI: () => void;
  onExportPDF: () => void;
  onJumpToItemPage: (itemId: string) => void;
}) {
  return (
    <div className="w-[280px] border-l flex flex-col p-4 overflow-y-auto">
      <div className="mb-4">
        <label className="text-sm font-medium mb-2 block">项目名称</label>
        <Input
          value={projectName}
          onChange={(e) => onProjectNameChange(e.target.value)}
          placeholder="请输入项目名称"
        />
      </div>

      <div className="mb-4">
        <h3 className="font-semibold mb-3 text-sm">管控审批清单</h3>
        <div className="space-y-2">
          {features.map((feature) => (
            <button
              key={feature.id}
              type="button"
              onClick={() => onJumpToItemPage(feature.id)}
              className="w-full flex items-center gap-2 text-sm py-1.5 text-left rounded-sm hover:bg-muted/60 transition-colors"
            >
              {feature.status === "pass" ? (
                <CheckSquare className="h-4 w-4 text-green-600" />
              ) : feature.status === "fail" ? (
                <SquareX className="h-4 w-4 text-red-600" />
              ) : (
                <Square className="h-4 w-4 text-gray-400" />
              )}
              <span className={feature.status === "idle" ? "text-muted-foreground" : ""}>
                {feature.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      <h3 className="font-semibold mb-4 text-sm">功能选项</h3>

      <div className="space-y-3 mb-4">
        {/* 一键加载审查项截图 */}
        <Button
          variant="outline"
          className="w-full"
          onClick={onCaptureScreenshot}
          disabled={isCapturingScreenshot}
        >
          {isCapturingScreenshot ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              截图中...
            </>
          ) : (
            <>
              <Camera className="h-4 w-4 mr-2" />
              一键加载审查项截图
            </>
          )}
        </Button>

        {/* 一键生成 AI 建议 */}
        <Button
          variant="outline"
          className="w-full"
          onClick={onGenerateAllAI}
          disabled={isGeneratingAI}
        >
          {isGeneratingAI ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              生成中（{aiProgress.completed}/{aiProgress.total || features.length}）
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4 mr-2" />
              一键填充审查方建议
            </>
          )}
        </Button>

        {/* 导出 PDF */}
        <Button
          className="w-full"
          onClick={onExportPDF}
        >
          <Download className="h-4 w-4 mr-2" />
          导出 PDF
        </Button>
      </div>

      {/* 提示信息 */}
      <div className="mt-6 text-xs text-muted-foreground space-y-2">
        <p>使用提示：</p>
        <ul className="list-disc list-inside space-y-1">
          <li>先一键加载审查项截图</li>
          <li>可一键填充审查方建议</li>
          <li>填写审查方建议</li>
          <li>最后导出PDF</li>
        </ul>
      </div>
    </div>
  );
}
