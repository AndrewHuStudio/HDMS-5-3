const ICP_FILING_NUMBER = "赣ICP备2026022319号-1";
const MIIT_FILING_URL = "https://beian.miit.gov.cn/";

export function SiteFilingLink() {
  return (
    <footer className="pointer-events-none fixed inset-x-0 bottom-1 z-[100] flex justify-center px-2">
      <a
        href={MIIT_FILING_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${ICP_FILING_NUMBER}，前往工信部备案管理系统查询`}
        className="pointer-events-auto rounded-md border border-border/60 bg-background/85 px-2 py-1 text-[11px] leading-none text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {ICP_FILING_NUMBER}
      </a>
    </footer>
  );
}
