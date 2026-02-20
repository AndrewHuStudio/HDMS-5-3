import re


def _split_protected_segments(text: str) -> list[str]:
    """
    Split by protected segments (fenced code blocks, inline code, existing $/$$ math).
    The returned list alternates between unprotected and protected segments.
    """
    # First protect code (fences + inline).
    parts = re.split(r"(```[\s\S]*?```|`[^`\n]*`)", text or "")
    out: list[str] = []
    for i, p in enumerate(parts):
        if i % 2 == 1:
            out.append(p)
        else:
            # Inside non-code, protect existing math segments.
            out.extend(
                re.split(
                    r"((?<!\\)\$\$[\s\S]*?(?<!\\)\$\$|(?<!\\)\$[^$]+?(?<!\\)\$)",
                    p,
                )
            )
    return out


def normalize_math_delimiters(text: str) -> str:
    """
    Normalize LaTeX math delimiters to the frontend-supported forms:
    - \\[ ... \\]  ->  $$ ... $$
    - \\( ... \\)  ->  $ ... $

    Does not modify fenced/inline code or existing $/$$ math segments.
    """
    if not text:
        return text

    parts = _split_protected_segments(text)
    result: list[str] = []
    for i, seg in enumerate(parts):
        # Protected segments are: code blocks/inline code and existing $/$$ formulas.
        if i % 2 == 1:
            result.append(seg)
            continue

        # Normalize escaped forms first.
        seg = seg.replace("\\\\[", "\\[").replace("\\\\]", "\\]")
        seg = seg.replace("\\\\(", "\\(").replace("\\\\)", "\\)")

        # Convert only paired block delimiters to avoid producing unmatched $$.
        seg = re.sub(r"\\\[\s*([\s\S]*?)\s*\\\]", lambda m: f"$$\n{m.group(1).strip()}\n$$", seg)
        # Convert only paired inline delimiters to avoid producing unmatched $.
        seg = re.sub(r"\\\(\s*([\s\S]*?)\s*\\\)", lambda m: f"${m.group(1).strip()}$", seg)

        result.append(seg)

    return "".join(result)


def unescape_dollar_delimiters(text: str) -> str:
    """
    Fix model outputs that escape dollar delimiters as \\$ ... \\$ or \\$\\$ ... \\$\\$,
    which prevents the frontend from rendering math.

    Does not modify code blocks/inline code or existing $/$$ math segments.
    """
    if not text:
        return text

    parts = _split_protected_segments(text)
    out: list[str] = []
    for i, seg in enumerate(parts):
        if i % 2 == 1:
            out.append(seg)
            continue

        # Convert escaped block delimiters first.
        seg = re.sub(r"\\\$\$([\s\S]*?)\\\$\$", r"$$\1$$", seg)
        # Convert escaped inline delimiters.
        seg = re.sub(r"\\\$(.+?)\\\$", r"$\1$", seg, flags=re.DOTALL)

        out.append(seg)

    return "".join(out)


# ---- Plain-text formula-to-LaTeX conversion patterns ----

# LHS term suffixes that signal a formula definition.
_FORMULA_SUFFIX = (
    r"(?:率|比|量|度|积|值|系数|密度|面积|高度|间距|指标|限值|"
    r"上限|下限|容积|覆盖|绿地|建筑|退线|距离|宽度|深度|层数|"
    r"FAR|GSI|GFA|BCR|OSR)"
)

# Pattern 1: equation  LHS = RHS  (covers =, >=, <=, >, <)
_FORMULA_LINE_RE = re.compile(
    r"(?<!\$)"
    r"([\u4e00-\u9fffA-Za-z_][\u4e00-\u9fff\w]*" + _FORMULA_SUFFIX + r")"
    r"\s*([=＝≥≤≧≦><]|>=|<=)\s*"
    r"([\u4e00-\u9fff\w\s\+\-\*×÷·/（）\(\)\d.,%％]+)"
    r"(?!\$)",
)

# Pattern 2: standalone inequality  A ≥ B  or  A ≤ B  (no LHS suffix requirement)
_INEQ_LINE_RE = re.compile(
    r"(?<!\$)"
    r"([\u4e00-\u9fffA-Za-z_][\u4e00-\u9fff\w]*)"
    r"\s*([≥≤≧≦]|>=|<=)\s*"
    r"([\u4e00-\u9fff\w\d.,%％\s\+\-\*×÷·/（）\(\)]+)"
    r"(?!\$)",
)

# Matches fraction-like patterns: A / B or A ÷ B
_FRAC_RE = re.compile(
    r"([\u4e00-\u9fff\w\s\+\-\*×·（）\(\)\d.,%％]+?)"
    r"\s*[/÷]\s*"
    r"([\u4e00-\u9fff\w\s\+\-\*×·（）\(\)\d.,%％]+)"
)

# Matches multiplication chains: A × B × C  or  A * B * C
_MUL_CHAIN_RE = re.compile(
    r"([\u4e00-\u9fff\w\d.,%％]+)"
    r"(\s*[×\*·]\s*[\u4e00-\u9fff\w\d.,%％]+)+"
)

# Operator mapping for LaTeX output.
_OP_MAP = {"=": "=", "\uff1d": "=", "\u2265": "\\geq", "\u2264": "\\leq",
           "\u2267": "\\geq", "\u2266": "\\leq", ">": ">", "<": "<",
           ">=": "\\geq", "<=": "\\leq"}


def convert_plain_formulas_to_latex(text: str) -> str:
    """Convert plain-text Chinese formulas to LaTeX using $...$.

    Already-LaTeX content ($...$, $$...$$) and code blocks are left untouched.
    """
    if not text:
        return text

    def _to_latex_term(s: str) -> str:
        """Wrap a Chinese/mixed term in \\text{}."""
        s = s.strip()
        s = re.sub(r"[（(]", "(", s)
        s = re.sub(r"[）)]", ")", s)
        if not s:
            return ""
        if re.match(r"^[\d.,%％]+$", s) or "\\" in s:
            return s
        # Pure ASCII identifier (e.g. FAR, GFA) — keep as math italic.
        if re.match(r"^[A-Za-z_]\w*$", s):
            return s
        return f"\\text{{{s}}}"

    def _convert_rhs(rhs: str) -> str:
        """Convert the right-hand side of a formula to LaTeX."""
        rhs = rhs.strip()
        # Try fraction first.
        frac_match = _FRAC_RE.match(rhs)
        if frac_match:
            num = _to_latex_term(frac_match.group(1))
            den = _to_latex_term(frac_match.group(2))
            return f"\\frac{{{num}}}{{{den}}}"
        # Try multiplication chain: A × B × C
        mul_match = _MUL_CHAIN_RE.match(rhs)
        if mul_match:
            parts = re.split(r"\s*[×\*·]\s*", rhs)
            return " \\times ".join(_to_latex_term(p) for p in parts if p.strip())
        return _to_latex_term(rhs)

    def _is_safe_context(text_: str, start: int) -> bool:
        """Return False if the match position is inside a context where LaTeX conversion is inappropriate."""
        line_start = text_.rfind("\n", 0, start) + 1
        line_end = text_.find("\n", start)
        if line_end == -1:
            line_end = len(text_)
        full_line = text_[line_start:line_end]
        prefix = text_[line_start:start].strip()
        if prefix.endswith(("(", "[", "`", "$")):
            return False
        # Skip table rows (lines starting with |).
        if prefix.startswith("|") or prefix.startswith("|-"):
            return False
        # Skip heading lines.
        if prefix.lstrip().startswith("#"):
            return False
        # Skip blockquote lines.
        if prefix.lstrip().startswith(">"):
            return False
        # Skip lines containing Chinese sentence punctuation (likely prose, not formulas).
        if any(ch in full_line for ch in "\uff0c\u3002\uff1b\uff01\uff1f\u3001"):
            return False
        return True

    def _formula_replacer(match: re.Match) -> str:
        if not _is_safe_context(text, match.start()):
            return match.group(0)
        rhs = match.group(3).strip()
        # Reject if RHS is purely Chinese text with no math operators.
        if re.match(r'^[\u4e00-\u9fff\s]+$', rhs) and not re.search(r'[+\-*/\u00d7\u00f7]', rhs):
            return match.group(0)
        lhs = match.group(1).strip()
        op = match.group(2).strip()
        latex_op = _OP_MAP.get(op, op)
        return f"${_to_latex_term(lhs)} {latex_op} {_convert_rhs(rhs)}$"

    def _ineq_replacer(match: re.Match) -> str:
        if not _is_safe_context(text, match.start()):
            return match.group(0)
        rhs = match.group(3).strip()
        # Reject if RHS is purely Chinese text with no math operators.
        if re.match(r'^[\u4e00-\u9fff\s]+$', rhs) and not re.search(r'[+\-*/\u00d7\u00f7]', rhs):
            return match.group(0)
        lhs = match.group(1).strip()
        op = match.group(2).strip()
        latex_op = _OP_MAP.get(op, op)
        return f"${_to_latex_term(lhs)} {latex_op} {_convert_rhs(rhs)}$"

    # Split text into LaTeX and non-LaTeX segments to protect existing formulas.
    segments = re.split(
        r"((?<!\\)\$\$[\s\S]*?(?<!\\)\$\$|(?<!\\)\$[^$]+?(?<!\\)\$)",
        text,
    )
    result_parts = []
    for i, seg in enumerate(segments):
        if i % 2 == 1:
            result_parts.append(seg)
        else:
            # Also skip fenced code blocks.
            code_parts = re.split(r"(```[\s\S]*?```|`[^`\n]*`)", seg)
            for j, cp in enumerate(code_parts):
                if j % 2 == 1:
                    result_parts.append(cp)
                else:
                    converted = _FORMULA_LINE_RE.sub(_formula_replacer, cp)
                    converted = _INEQ_LINE_RE.sub(_ineq_replacer, converted)
                    result_parts.append(converted)

    return "".join(result_parts)


_TEXT_PAREN_RE = re.compile(r"\\text\s*[（(]\s*([^（）()]+?)\s*[）)]")
_LATEX_ATOM_RE = (
    r"(?:\\text\{[^{}]+\}|\\mathrm\{[^{}]+\}|\\operatorname\{[^{}]+\}|"
    r"\\frac\{[^{}]+\}\{[^{}]+\}|"
    r"[A-Za-z][A-Za-z0-9_]*|"
    r"\d+(?:\.\d+)?(?:[%％])?)"
)
_LATEX_REL_OP_RE = r"(?:\\geq|\\leq|\\gt|\\lt|\\neq|\\approx|>=|<=|=|>|<)"
_BARE_LATEX_RELATION_RE = re.compile(
    rf"(?<![$\\])({_LATEX_ATOM_RE}(?:\s*{_LATEX_REL_OP_RE}\s*{_LATEX_ATOM_RE})+)"
)


def normalize_bare_latex_math(text: str) -> str:
    """
    Normalize common bare LaTeX fragments that lack $...$ delimiters.

    Handles patterns like:
    - \\text(二级) \\geq \\text{50%}
    - \\text{二级} \\geq \\text{50%}

    Existing math/code segments are preserved.
    """
    if not text:
        return text

    parts = _split_protected_segments(text)
    out: list[str] = []

    for i, seg in enumerate(parts):
        if i % 2 == 1:
            out.append(seg)
            continue

        # Some model outputs use \text(...) which KaTeX doesn't parse.
        seg = _TEXT_PAREN_RE.sub(r"\\text{\1}", seg)
        # Wrap bare LaTeX inequalities/equalities so remark-math can parse them.
        seg = _BARE_LATEX_RELATION_RE.sub(lambda m: f"${m.group(1).strip()}$", seg)
        out.append(seg)

    return "".join(out)
