// Ephemeral in-memory PA request store (NO PHI persisted to DB). 30-min TTL.
const SESSION_TTL_MS = 30 * 60 * 1000;
const store = new Map();

function purgeExpired() {
  const now = Date.now();
  for (const [id, rec] of store.entries()) {
    if (now - rec.created_at > SESSION_TTL_MS) store.delete(id);
  }
}

function put(id, rec) {
  store.set(id, rec);
}

function get(id, userId) {
  purgeExpired();
  const rec = store.get(id);
  if (!rec || rec.user_id !== userId) return null;
  return rec;
}

function remove(id, userId) {
  const rec = store.get(id);
  if (rec && rec.user_id === userId) store.delete(id);
}

function startSweeper() {
  setInterval(purgeExpired, 60 * 1000);
}

module.exports = { put, get, remove, startSweeper, SESSION_TTL_MS };
