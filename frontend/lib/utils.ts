/**
 * 通用工具函数
 * cn: 合并 Tailwind CSS 类名（使用 clsx + tailwind-merge）
 */
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
