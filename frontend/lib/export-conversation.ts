import type { ChatMessage, SourceInfo } from "@/features/qa/types";

function formatSource(source: SourceInfo, index: number): string {
  const typeLabel = source.source === "knowledge_graph" ? "知识图谱" : "文档检索";
  const section = source.section ? ` - ${source.section}` : "";
  return `  ${index}. [${typeLabel}] ${source.name || "未知来源"}${section}`;
}

export function messagesToMarkdown(messages: ChatMessage[]): string {
  const now = new Date();
  const timestamp = now.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const lines: string[] = [
    "# HDMS 问答记录",
    "",
    `> 导出时间: ${timestamp}`,
    "",
    "---",
    "",
  ];

  const contentMessages = messages.filter((m) => m.id !== "welcome");

  for (const message of contentMessages) {
    if (message.role === "user") {
      lines.push(`## Q: ${message.content}`);
      lines.push("");
    } else if (message.role === "assistant") {
      if (message.content) {
        lines.push(message.content);
        lines.push("");
      }

      if (message.sources && message.sources.length > 0) {
        lines.push("**引用来源:**");
        lines.push("");
        message.sources.forEach((source, idx) => {
          lines.push(formatSource(source, idx + 1));
        });
        lines.push("");
      }

      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function downloadAsFile(
  content: string,
  filename: string,
  mimeType: string = "text/markdown;charset=utf-8",
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportConversation(messages: ChatMessage[]): void {
  const markdown = messagesToMarkdown(messages);
  const now = new Date();
  const dateStr = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  const timeStr = [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
  ].join("");
  const filename = `HDMS问答_${dateStr}_${timeStr}.md`;
  downloadAsFile(markdown, filename);
}
