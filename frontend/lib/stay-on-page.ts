type HighlightFn = (keyword: string) => Promise<unknown[]>;

type HighlightAndStayOnPageArgs = {
  keyword: string;
  highlight: HighlightFn;
  jumpToPage?: (pageIndex: number) => void | Promise<void>;
  stayOnPageIndex: number;
};

export async function highlightAndStayOnPage(args: HighlightAndStayOnPageArgs): Promise<unknown[]> {
  const { keyword, highlight, jumpToPage, stayOnPageIndex } = args;
  const matches = await highlight(keyword);

  if (jumpToPage) {
    void jumpToPage(stayOnPageIndex);
    requestAnimationFrame(() => {
      void jumpToPage(stayOnPageIndex);
    });
  }

  return matches;
}

