/**
 * QA Markdown 表格渲染组件
 * 独立模块：表格容器、表头单元格、数据单元格的自定义渲染。
 */
import type { ReactNode } from "react";
import type { Components } from "react-markdown";

export const QA_TABLE_COMPONENTS: Partial<Components> = {
  table: ({ children }: { children?: ReactNode }) => (
    <div className="qa-table-wrap mb-2 overflow-x-auto rounded-md border border-border/80 bg-white/90 dark:bg-background/75">
      <table className="w-full table-fixed border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className="border border-border bg-white/80 px-2 py-1 text-left font-semibold break-words dark:bg-muted/45">
      {children}
    </th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="border border-border bg-white/55 px-2 py-1 break-words dark:bg-transparent">{children}</td>
  ),
};
