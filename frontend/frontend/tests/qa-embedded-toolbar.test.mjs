import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();

function readProjectFile(relativePath) {
  const fullPath = path.join(projectRoot, relativePath);
  assert.ok(fs.existsSync(fullPath), `expected file to exist: ${relativePath}`);
  return fs.readFileSync(fullPath, 'utf8');
}

test('embedded QA view composes the drawer body without owning the top sidebar header', () => {
  const qaView = readProjectFile('features/qa/qa-view.tsx');

  assert.match(qaView, /QAConversationHistoryPanel/, 'QAView should render a dedicated history drawer component');
  assert.match(qaView, /historyOpen\?: boolean/, 'QAView should accept drawer visibility from the workspace shell');
  assert.match(qaView, /onHistoryOpenChange\?: \(open: boolean\) => void/, 'QAView should let the shell control drawer visibility');
  assert.match(qaView, /historyOpen=\{historyOpen\}/, 'QAView should pass the open state into child assistant controls');
  assert.match(qaView, /onSwitchConversation=\{handleSwitchConversation\}/, 'QAView should keep conversation switching wired through the history drawer');
  assert.doesNotMatch(qaView, /QAConversationToolbar/, 'QAView should not render a lowered header card inside the assistant body');
});

test('assistant toolbar exposes compact branded history toggle controls', () => {
  const toolbar = readProjectFile('components/qa-new/qa-conversation-toolbar.tsx');

  assert.match(toolbar, /管控问答助手/, 'toolbar should display the assistant title');
  assert.match(toolbar, /历史对话/, 'toolbar should expose a dedicated history toggle button');
  assert.match(toolbar, /historyOpen: boolean/, 'toolbar should know whether the history drawer is open');
  assert.match(toolbar, /onToggleHistory: \(\) => void/, 'toolbar should toggle the history drawer from the header action');
});

test('history drawer keeps conversation management actions in the slide-out list', () => {
  const historyPanel = readProjectFile('components/qa-new/qa-conversation-history-panel.tsx');

  assert.match(historyPanel, /新建对话/, 'history drawer should let users create a new conversation');
  assert.match(historyPanel, /最近更新/, 'history drawer should show conversation recency');
  assert.match(historyPanel, /重命名/, 'history drawer should support rename management');
  assert.match(historyPanel, /删除/, 'history drawer should support delete management');
  assert.match(historyPanel, /置顶|取消置顶/, 'history drawer should support pin management');
});

test('workspace shell owns assistant drawer width and closes it from viewport clicks', () => {
  const shell = readProjectFile('components/workspace/persistent-workspace-shell.tsx');

  assert.match(shell, /QAConversationToolbar/, 'workspace shell should own the assistant top header');
  assert.match(shell, /assistantHistoryOpen/, 'workspace shell should track whether the assistant history drawer is open');
  assert.match(shell, /assistantPanelWidth/, 'workspace shell should compute the assistant aside width from drawer state');
  assert.match(shell, /historyOpen=\{assistantHistoryOpen\}/, 'workspace shell should pass drawer state into the embedded QA view');
  assert.match(shell, /onHistoryOpenChange=\{setAssistantHistoryOpen\}/, 'workspace shell should pass the drawer state setter into QAView');
  assert.match(shell, /setAssistantHistoryOpen\(false\)/, 'workspace shell should collapse the drawer when the viewport is clicked');
  assert.match(shell, /h-12 border-b border-border flex items-center px-4 flex-shrink-0/, 'assistant sidebar header should align with the main viewport header line');
});
