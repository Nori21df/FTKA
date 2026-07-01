/**
 * responseCache.js
 * Cache đơn giản trong bộ nhớ (in-memory), key = hash(messages + taskType).
 * Phù hợp với TOPIK vì nhiều câu hỏi/từ vựng lặp lại giữa các phiên học.
 * Có thể thay bằng Redis nếu cần persist qua nhiều lần khởi động lại server.
 */

const crypto = require("crypto");

class ResponseCache {
  constructor({ ttlMs = 24 * 60 * 60 * 1000, maxEntries = 5000 } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.store = new Map(); // key -> { value, expiresAt }
  }

  _hashKey(messages, taskType) {
    const raw = JSON.stringify({ messages, taskType });
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  get(messages, taskType) {
    const key = this._hashKey(messages, taskType);
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(messages, taskType, value) {
    const key = this._hashKey(messages, taskType);

    // Đơn giản hóa LRU: nếu vượt maxEntries thì xóa entry cũ nhất
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      this.store.delete(oldestKey);
    }

    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  clear() {
    this.store.clear();
  }
}

module.exports = { ResponseCache };
