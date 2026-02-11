"use client";

import { useRef, useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SightCorridorPosition, PlanViewBuilding, PlanViewPoint } from "@/lib/sight-corridor-types";

interface SightCorridorPlanViewProps {
  isActive: boolean;
  observerPosition: SightCorridorPosition | null;
  hemisphereRadius: number;
  modelBounds?: { min: [number, number, number]; max: [number, number, number] };
  buildings?: PlanViewBuilding[];
  onPositionClick?: (position: SightCorridorPosition) => void;
}

export function SightCorridorPlanView({
  isActive,
  observerPosition,
  hemisphereRadius,
  modelBounds,
  buildings = [],
  onPositionClick,
}: SightCorridorPlanViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 300, height: 300 });
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === "dark";
  const backgroundColor = isDarkTheme ? "#0b0f1a" : "#f8fafc";
  const gridLineColor = isDarkTheme ? "rgba(255, 255, 255, 0.35)" : "#e2e8f0";
  const buildingFill = isDarkTheme ? "#1f2937" : "#e2e8f0";
  const buildingStroke = isDarkTheme ? "#e2e8f0" : "#94a3b8";
  const hintColor = isDarkTheme ? "#cbd5e1" : "#64748b";

  // 处理画布点击
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isActive || !onPositionClick || !modelBounds) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // 计算缩放和偏移（与绘制逻辑保持一致）
    const boundsWidth = modelBounds.max[0] - modelBounds.min[0];
    const boundsHeight = modelBounds.max[1] - modelBounds.min[1];
    if (boundsWidth <= 0 || boundsHeight <= 0) return;
    const padding = 20;
    const drawWidth = canvas.width - padding * 2;
    const drawHeight = canvas.height - padding * 2;
    const scaleX = drawWidth / boundsWidth;
    const scaleY = drawHeight / boundsHeight;
    const scale = Math.min(scaleX, scaleY);
    const offsetX = padding + (drawWidth - boundsWidth * scale) / 2;
    const offsetY = padding + (drawHeight - boundsHeight * scale) / 2;

    // 画布坐标转世界坐标
    const worldX = modelBounds.min[0] + (clickX - offsetX) / scale;
    const worldY = modelBounds.max[1] - (clickY - offsetY) / scale;

    onPositionClick({
      x: worldX,
      y: worldY,
      z: 0, // 贴地
    });
  };

  // 绘制平面图
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 清空画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 绘制背景
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 如果有模型边界，绘制建筑物
    if (modelBounds && buildings.length > 0) {
      const boundsWidth = modelBounds.max[0] - modelBounds.min[0];
      const boundsHeight = modelBounds.max[1] - modelBounds.min[1];
      if (boundsWidth <= 0 || boundsHeight <= 0) return;

      // 添加padding
      const padding = 20;
      const drawWidth = canvas.width - padding * 2;
      const drawHeight = canvas.height - padding * 2;

      // 计算缩放比例（保持宽高比）
      const scaleX = drawWidth / boundsWidth;
      const scaleY = drawHeight / boundsHeight;
      const scale = Math.min(scaleX, scaleY);

      // 计算偏移量（居中）
      const offsetX = padding + (drawWidth - boundsWidth * scale) / 2;
      const offsetY = padding + (drawHeight - boundsHeight * scale) / 2;

      // 世界坐标转画布坐标的辅助函数
      const worldToCanvas = (worldX: number, worldY: number) => {
        const canvasX = offsetX + (worldX - modelBounds.min[0]) * scale;
        const canvasY = offsetY + (modelBounds.max[1] - worldY) * scale;
        return { x: canvasX, y: canvasY };
      };

      const drawFootprint = (points: PlanViewPoint[]) => {
        if (points.length < 3) return;
        const first = worldToCanvas(points[0].x, points[0].y);
        ctx.beginPath();
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < points.length; i += 1) {
          const p = worldToCanvas(points[i].x, points[i].y);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fillStyle = buildingFill;
        ctx.fill();
        ctx.strokeStyle = buildingStroke;
        ctx.lineWidth = 1;
        ctx.stroke();
      };

      // 绘制建筑物（俯视轮廓）
      buildings.forEach((building) => {
        if (building.footprint && building.footprint.length >= 3) {
          drawFootprint(building.footprint);
          return;
        }

        const topLeft = worldToCanvas(building.min[0], building.max[1]);
        const bottomRight = worldToCanvas(building.max[0], building.min[1]);
        const width = bottomRight.x - topLeft.x;
        const height = bottomRight.y - topLeft.y;

        ctx.fillStyle = buildingFill;
        ctx.fillRect(topLeft.x, topLeft.y, width, height);
        ctx.strokeStyle = buildingStroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(topLeft.x, topLeft.y, width, height);
      });

      // 如果有观察者位置，绘制观察者和半球范围
      if (observerPosition) {
        const observerCanvas = worldToCanvas(observerPosition.x, observerPosition.y);
        const radius = hemisphereRadius * scale;

        // 绘制半球范围（径向渐变）
        ctx.beginPath();
        ctx.arc(observerCanvas.x, observerCanvas.y, radius, 0, Math.PI * 2);
        const gradient = ctx.createRadialGradient(
          observerCanvas.x,
          observerCanvas.y,
          radius * 0.1,
          observerCanvas.x,
          observerCanvas.y,
          radius
        );
        gradient.addColorStop(0, isDarkTheme ? "rgba(56, 189, 248, 0.25)" : "rgba(248, 250, 252, 0.3)");
        gradient.addColorStop(0.6, isDarkTheme ? "rgba(34, 197, 94, 0.2)" : "rgba(34, 197, 94, 0.15)");
        gradient.addColorStop(1, isDarkTheme ? "rgba(34, 197, 94, 0.06)" : "rgba(34, 197, 94, 0.03)");
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.strokeStyle = isDarkTheme ? "rgba(34, 197, 94, 0.7)" : "rgba(34, 197, 94, 0.5)";
        ctx.lineWidth = 2;
        ctx.stroke();

        // 绘制观察者（深红色圆点）
        ctx.beginPath();
        ctx.arc(observerCanvas.x, observerCanvas.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = "#991b1b";
        ctx.fill();
        ctx.strokeStyle = isDarkTheme ? "#e2e8f0" : "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    } else {
      // 没有建筑数据时，绘制简单网格
      ctx.strokeStyle = gridLineColor;
      ctx.lineWidth = 1;
      const gridSize = 20;
      for (let x = 0; x < canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
    }

    // 绘制提示文字
    if (isActive && !observerPosition) {
      ctx.fillStyle = hintColor;
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("点击放置检测点", canvas.width / 2, canvas.height / 2);
    }
  }, [
    observerPosition,
    hemisphereRadius,
    modelBounds,
    buildings,
    isActive,
    backgroundColor,
    buildingFill,
    buildingStroke,
    gridLineColor,
    hintColor,
    isDarkTheme,
  ]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">平面图</CardTitle>
      </CardHeader>
      <CardContent>
        <canvas
          ref={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
          className="w-full border border-border rounded cursor-crosshair"
          onClick={handleCanvasClick}
          style={{ aspectRatio: "1/1" }}
        />
      </CardContent>
    </Card>
  );
}
