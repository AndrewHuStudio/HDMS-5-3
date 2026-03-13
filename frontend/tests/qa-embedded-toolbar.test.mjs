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

test('embedded QA view wires a conversation toolbar for history management', () => {
  const qaView = readProjectFile('features/qa/qa-view.tsx');

  assert.match(qaView, /QAConversationToolbar/, 'QAView should import and render the conversation toolbar');
  assert.match(qaView, /conversations=\{conversations\}/, 'QAView should pass conversation history into the toolbar');
  assert.match(qaView, /activeConversationId=\{activeConversationId\}/, 'QAView should pass the active conversation into the toolbar');
  assert.match(qaView, /onCreateConversation=\{handleCreateConversation\}/, 'QAView should let the toolbar create new conversations');
  assert.match(qaView, /onSwitchConversation=\{handleSwitchConversation\}/, 'QAView should let the toolbar switch conversation history');
});

test('conversation toolbar exposes visible history-management actions', () => {
  const toolbar = readProjectFile('components/qa-new/qa-conversation-toolbar.tsx');

  assert.match(toolbar, /新建对话/, 'toolbar should expose a new conversation action');
  assert.match(toolbar, /历史对话|历史会话/, 'toolbar should expose a history conversation selector');
  assert.match(toolbar, /重命名/, 'toolbar should support rename management');
  assert.match(toolbar, /删除/, 'toolbar should support delete management');
  assert.match(toolbar, /置顶|取消置顶/, 'toolbar should support pin management');
});
