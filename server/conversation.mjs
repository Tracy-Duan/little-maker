import { DatabaseSync } from 'node:sqlite';

const pageSize = 50;
const contextMessageLimit = 24;
const contextByteLimit = 12_000;

export function openConversation(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY,
      message_key TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('chat', 'event'))
    );
    CREATE INDEX IF NOT EXISTS messages_by_kind ON messages(kind, id);
  `);
  const insert = db.prepare('INSERT INTO messages (message_key, role, content, kind) VALUES (?, ?, ?, ?) ON CONFLICT(message_key) DO NOTHING');
  const find = db.prepare('SELECT id, message_key AS key, role, content FROM messages WHERE message_key = ?');
  const latest = db.prepare('SELECT id, message_key AS key, role, content FROM messages ORDER BY id DESC LIMIT ?');
  const older = db.prepare('SELECT id, message_key AS key, role, content FROM messages WHERE id < ? ORDER BY id DESC LIMIT ?');
  const context = db.prepare("SELECT role, content FROM messages WHERE kind = 'chat' AND id < ? ORDER BY id DESC LIMIT ?");

  function record(key, role, text, kind = 'chat') {
    insert.run(key, role, text, kind);
    return find.get(key);
  }

  function recordAudioTurn(key, transcript, text) {
    db.exec('BEGIN');
    try {
      const messages = [
        record(key + ':user', 'user', transcript || '语音消息'),
        record(key + ':reply', 'assistant', text),
      ];
      db.exec('COMMIT');
      return messages;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  return {
    record, recordAudioTurn,
    find: key => find.get(key),
    page(before) {
      const rows = before ? older.all(before, pageSize + 1) : latest.all(pageSize + 1);
      return { messages: rows.slice(0, pageSize).reverse(), hasMore: rows.length > pageSize };
    },
    recentContext(before = Number.MAX_SAFE_INTEGER) {
      const selected = [];
      let bytes = 0;
      for (const row of context.all(before, contextMessageLimit)) {
        bytes += Buffer.byteLength(row.content, 'utf8') + 32;
        if (bytes > contextByteLimit) break;
        selected.push(row);
      }
      selected.reverse();
      if (selected[0]?.role === 'assistant') selected.shift();
      return selected;
    },
    close: () => db.close(),
  };
}
