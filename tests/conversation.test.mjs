import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openConversation } from '../server/conversation.mjs';

test('closed and reopened conversation retains every message with older pages and one copy per key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maker-conversation-'));
  const path = join(dir, 'chat.sqlite');
  let store;
  try {
    store = openConversation(path);
    for (let i = 1; i <= 60; i++) store.record('turn:' + i, 'user', '消息 ' + i);
    store.record('turn:60', 'user', '重复发送');
    store.close();
    store = openConversation(path);
    const recent = store.page();
    assert.equal(recent.messages.length, 50);
    assert.equal(recent.messages.at(-1).content, '消息 60');
    assert.equal(recent.hasMore, true);
    const earlier = store.page(recent.messages[0].id);
    assert.equal(earlier.messages.length, 10);
    assert.equal(earlier.messages[0].content, '消息 1');
    assert.equal(earlier.hasMore, false);
    const voice = store.recordAudioTurn('voice', '一只兔子', '它住在哪里？');
    assert.deepEqual(voice.map(message => message.role), ['user', 'assistant']);
  } finally {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('model context trims whole old messages while keeping the saved transcript', () => {
  const store = openConversation(':memory:');
  try {
    for (let i = 1; i <= 16; i++) {
      store.record('user:' + i, 'user', `${i} ${'画'.repeat(500)}`);
      store.record('reply:' + i, 'assistant', `${i} ${'树'.repeat(500)}`);
    }
    store.record('job', 'assistant', '作品已完成', 'event');
    const pending = store.record('pending:user', 'user', '最新消息');
    const context = store.recentContext(pending.id);
    assert.equal(context[0].role, 'user');
    assert.ok(context.at(-1).content.startsWith('16 '));
    assert.ok(context.length < 12);
    assert.ok(context.every(message => !['作品已完成', '最新消息'].includes(message.content)));
    assert.equal(store.page().messages.length, 34);
  } finally {
    store.close();
  }
});
