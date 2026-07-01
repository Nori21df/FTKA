/**
 * sessionAffinity.js
 * Ghi nhớ provider đã dùng thành công gần nhất cho mỗi sessionId,
 * để các câu hỏi tiếp theo trong cùng phiên ưu tiên dùng lại provider đó
 * (giữ văn phong trả lời nhất quán), miễn là nó vẫn "khỏe" (qua circuit breaker + quota).
 */

class SessionAffinity {
  constructor({ ttlMs = 30 * 60 * 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.sessions = new Map(); // sessionId -> { providerName, updatedAt }
  }

  get(sessionId) {
    if (!sessionId) return null;
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;
    if (Date.now() - entry.updatedAt > this.ttlMs) {
      this.sessions.delete(sessionId);
      return null;
    }
    return entry.providerName;
  }

  set(sessionId, providerName) {
    if (!sessionId) return;
    this.sessions.set(sessionId, { providerName, updatedAt: Date.now() });
  }

  clear(sessionId) {
    this.sessions.delete(sessionId);
  }
}

module.exports = { SessionAffinity };
