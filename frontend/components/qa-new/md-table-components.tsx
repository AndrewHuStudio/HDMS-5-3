/**
 * QA Markdown 表格渲染组件
 * 独立模块：表格容器、表头单元格、数据单元格的自定义渲染。
 */
import type { ReactNode } from "react";
import type { Components } from "react-markdown";

export const QA_TABLE_COMPONENTS: Partial<Components> = {
  table: ({ children }: { children?: ReactNode }) => (
    <div className="qa-table-wrap mb-3 overflow-x-auto rounded-xl border border-slate-200/90 bg-white/95 shadow-[0_8px_24px_rgba(15,23,42,0.06)] dark:border-border/70 dark:bg-background/75 dark:shadow-none">
      <table className="qa-data-table w-full table-fixed border-collapse text-[12px] leading-6">{children}</table>
    </div>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className="qa-table-head border border-slate-200/90 bg-slate-50/95 px-3 py-2 text-left text-[11px] font-semibold tracking-[0.02em] text-slate-700 break-words dark:border-border dark:bg-muted/45 dark:text-foreground">
      {children}
    </th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="qa-table-cell border border-slate-200/80 bg-white px-3 py-2 align-top text-[12px] text-slate-700 break-words dark:border-border dark:bg-transparent dark:text-foreground/90">{children}</td>
  ),
};
