# Task Plan

## Goal
Implement the assistant-side panel redesign so the QA view uses a review-tool-style right layout, adds a theme-aligned history drawer, and shrinks the 3D viewport when the drawer is open.

## Phases
- [completed] Inspect current assistant shell, QA view, and existing tests.
- [completed] Add failing regression tests for the history drawer controls and collapse rules.
- [completed] Implement the new assistant toolbar, right-side drawer layout, and viewport-dismiss interaction.
- [completed] Verify with targeted tests and a relevant frontend build/check.

## Confirmed Requirements
- Right-side assistant area should visually align with the `限高检测` style rather than the current full chat sidebar style.
- Top area should include a small logo and the `管控问答助手` title.
- Top-right should expose a theme-aligned `历史对话` button.
- Clicking the history button opens a sliding history list on the far right and compresses the 3D viewport.
- Clicking the history button again closes the history list.
- Clicking the main viewport also closes the history list.
- Clicking a history conversation switches the active conversation but does not auto-close the history list.
