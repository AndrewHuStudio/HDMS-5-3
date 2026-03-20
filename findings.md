# Findings

- `/assistant` currently renders a fixed `400px` aside directly from `PersistentWorkspaceShell`, so drawer-driven viewport compression needs to be introduced at that shell level.
- Embedded QA history management currently lives inside `QAConversationToolbar` as a select/dropdown, which does not match the requested slide-out history list.
- Existing frontend coverage for embedded QA is a `node:test` file that statically inspects source files; the new behavior can be guarded the same way without introducing a new test harness.
- `QAShell` already handles the actual chat transcript and input area, so the redesign can focus on shell composition and toolbar/history navigation instead of rewriting chat rendering.
- The clean implementation split is: shell owns drawer visibility and aside width; `QAView` owns assistant content composition; a new history-panel component owns create/switch/rename/delete/pin controls.
- A pointer-down handler on the central viewport container is sufficient to satisfy the requested "click main viewport to close history" behavior without affecting right-side controls.
- The first assistant redesign still misplaced the assistant header inside the assistant content body. The correct structure is: assistant sidebar header belongs to `PersistentWorkspaceShell`, aligned with the viewport top bar, while `QAView` only renders the area below that header.
