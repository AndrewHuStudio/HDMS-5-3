# Repository Instructions

These rules apply to every AI coding agent working in this repository.

## Mandatory Module Size Rule

- No source module may exceed 600 physical lines after an agent changes it.
- Treat a "module" as a single source file for Python, TypeScript, JavaScript, React components, and similar application code.
- Before editing an existing source file, check its line count. If it is already over 600 lines, split or extract focused helpers/components first, then make the behavioral change.
- When adding new functionality, design it as small, cohesive modules instead of growing a large file.
- After editing, verify every touched source module is at or below 600 lines.
- Generated files, vendored dependencies, build output, lockfiles, and large static assets are excluded from this rule.
- If a temporary exception is unavoidable, stop and document the reason and the follow-up split plan before continuing.

Preferred local check:

```powershell
.\scripts\check-module-lines.ps1
```

