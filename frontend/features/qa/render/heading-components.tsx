import React from "react";
import type { Components } from "react-markdown";
import type { ReactNode } from "react";

export type QAHeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

export const QA_HEADING_CLASS_MAP: Record<QAHeadingLevel, string> = {
  h1: "qa-heading-0 mt-7 mb-3 text-[1.1rem] font-extrabold tracking-tight text-slate-900",
  h2: "qa-heading-1 mt-6 mb-3 rounded-r-xl border-l-4 border-sky-600 bg-gradient-to-r from-sky-50 to-transparent px-3 py-1.5 text-[1rem] font-bold text-sky-900",
  h3: "qa-heading-2 mt-5 mb-2 text-[15px] font-semibold text-slate-900",
  h4: "qa-heading-3 mt-4 mb-1.5 text-sm font-semibold text-slate-700",
  h5: "qa-heading-4 mt-2.5 mb-1 text-xs font-semibold uppercase tracking-wide text-foreground/75",
  h6: "qa-heading-5 mt-2 mb-1 text-xs font-medium text-muted-foreground",
};

function renderHeading(level: QAHeadingLevel, children: ReactNode) {
  const className = QA_HEADING_CLASS_MAP[level];
  switch (level) {
    case "h1":
      return <h1 className={className}>{children}</h1>;
    case "h2":
      return <h2 className={className}>{children}</h2>;
    case "h3":
      return <h3 className={className}>{children}</h3>;
    case "h4":
      return <h4 className={className}>{children}</h4>;
    case "h5":
      return <h5 className={className}>{children}</h5>;
    case "h6":
    default:
      return <h6 className={className}>{children}</h6>;
  }
}

export const QA_HEADING_COMPONENTS: Pick<Components, QAHeadingLevel> = {
  h1: ({ children }) => renderHeading("h1", children),
  h2: ({ children }) => renderHeading("h2", children),
  h3: ({ children }) => renderHeading("h3", children),
  h4: ({ children }) => renderHeading("h4", children),
  h5: ({ children }) => renderHeading("h5", children),
  h6: ({ children }) => renderHeading("h6", children),
};
