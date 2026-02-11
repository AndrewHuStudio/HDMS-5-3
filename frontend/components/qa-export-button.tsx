"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { toast } from "sonner";
import type { ChatMessage } from "@/features/qa/types";
import { exportConversation } from "@/lib/export-conversation";

interface QAExportButtonProps {
  messages: ChatMessage[];
  disabled?: boolean;
}

export function QAExportButton({ messages, disabled }: QAExportButtonProps) {
  const handleExport = () => {
    const contentMessages = messages.filter((m) => m.id !== "welcome");
    if (contentMessages.length === 0) {
      toast.info("当前没有可导出的对话内容");
      return;
    }

    try {
      exportConversation(messages);
      toast.success("对话已导出为 Markdown 文件");
    } catch (err) {
      console.warn("Export failed:", err);
      toast.error("导出失败，请重试");
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      onClick={handleExport}
      disabled={disabled}
    >
      <Download className="h-3.5 w-3.5" />
      导出
    </Button>
  );
}
