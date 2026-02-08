"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Upload, FileBox, X, Check, AlertCircle } from "lucide-react";

export interface LayerInfo {
  index: number;
  id: string | null;
  name: string;
  full_path: string | null;
  parent_id: string | null;
  parent_index: number | null;
  visible: boolean;
  object_count: number;
}

interface ModelUploaderProps {
  onModelLoad: (
    url: string,
    fileName: string,
    fileType: ModelFileType,
    modelPath?: string,
    layers?: LayerInfo[],
    file?: File
  ) => void;
  currentModel: string | null;
  currentModelName?: string | null;
  onClearModel: () => void;
}

type ModelFileType = "3dm" | "glb" | "gltf";

export function ModelUploader({ onModelLoad, currentModel, currentModelName, onClearModel }: ModelUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const lastObjectUrlRef = useRef<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);

    // 检查文件类型
    const validExtensions = ['.glb', '.gltf', '.3dm'];
    const extension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));

    if (!validExtensions.includes(extension)) {
      setError("请上传 .3dm, .glb 或 .gltf 格式的模型文件");
      return;
    }

    // 检查文件大小 (最大 500MB)
    if (file.size > 500 * 1024 * 1024) {
      setError("不可以放置超过500mb的模型");
      return;
    }

    try {
      const url = URL.createObjectURL(file);
      if (lastObjectUrlRef.current && lastObjectUrlRef.current !== url) {
        URL.revokeObjectURL(lastObjectUrlRef.current);
      }
      lastObjectUrlRef.current = url;

      const fileType = extension.slice(1) as ModelFileType;
      setFileName(file.name);
      // 只做本地加载，不进行预上传
      onModelLoad(url, file.name, fileType, undefined, undefined, file);
      setIsOpen(false);
    } catch (err: any) {
      setError(err.message || "文件处理失败");
    }
  }, [onModelLoad]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  }, [handleFile]);

  return (
    <div className="flex items-center gap-2">
      {currentModel ? (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800 rounded">
          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
          <span className="text-xs text-emerald-700 dark:text-emerald-200 max-w-[120px] truncate">
            {currentModelName || fileName || "已加载模型"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 w-5 p-0 hover:bg-emerald-100 dark:hover:bg-emerald-900/60"
            onClick={() => {
              onClearModel();
              setFileName(null);
            }}
          >
            <X className="h-3 w-3 text-emerald-600 dark:text-emerald-300" />
          </Button>
        </div>
      ) : (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 bg-transparent">
              <Upload className="h-4 w-4" />
              导入模型
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md gap-0 pt-4">
            <DialogTitle className="sr-only">导入模型</DialogTitle>
            <DialogDescription className="sr-only">
              上传 Rhino 3dm 模型用于管控检测与三维展示。
            </DialogDescription>
            <div
              className={`
                border-2 border-dashed rounded-lg p-8 text-center transition-colors mt-2
                ${isDragging
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary/50"
                }
              `}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <FileBox className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <label>
                <input
                  type="file"
                  accept=".glb,.gltf,.3dm"
                  className="hidden"
                  onChange={handleFileInput}
                />
                <Button variant="secondary" size="sm" className="cursor-pointer" asChild>
                  <span>选择文件</span>
                </Button>
              </label>
            </div>

            <div className="mt-4 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <div className="mb-2 text-[13px] font-medium text-foreground/80">导入要求</div>
              <ol className="space-y-1.5">
                <li className="flex gap-2">
                  <span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-background text-[10px] font-semibold text-foreground/80 ring-1 ring-border">1</span>
                  <span>支持导入 Rhino 模型（.3dm）。</span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-background text-[10px] font-semibold text-foreground/80 ring-1 ring-border">2</span>
                  <span>模型体积 20MB 以下。</span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-background text-[10px] font-semibold text-foreground/80 ring-1 ring-border">3</span>
                  <span>导入前请完成图层分类。</span>
                </li>
              </ol>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                <AlertCircle className="h-4 w-4 text-destructive" />
                <span className="text-sm text-destructive">{error}</span>
              </div>
            )}

          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
