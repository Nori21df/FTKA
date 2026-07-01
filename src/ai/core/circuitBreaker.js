/**
 * circuitBreaker.js
 * Theo dõi trạng thái health của từng provider.
 * Nếu 1 provider lỗi liên tiếp >= threshold lần, đánh dấu "open" (tạm ngắt)
 * trong cooldownMs, sau đó tự động cho thử lại ("half-open").
 */

class CircuitBreaker {
  constructor({ failureThreshold = 3, cooldownMs = 60_000 } = {}) {
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    // state: { failures, state: 'closed'|'open'|'half-open', openedAt }
    this.states = new Map();
  }

  _get(providerName) {
    if (!this.states.has(providerName)) {
      this.states.set(providerName, { failures: 0, state: "closed", openedAt: null });
    }
    return this.states.get(providerName);
  }

  /** Kiểm tra xem provider có đang bị "open" (tạm ngắt) hay không */
  isAvailable(providerName) {
    const s = this._get(providerName);
    if (s.state === "closed") return true;

    if (s.state === "open") {
      const elapsed = Date.now() - s.openedAt;
      if (elapsed >= this.cooldownMs) {
        // Hết thời gian cooldown -> chuyển sang half-open, cho thử lại 1 lần
        s.state = "half-open";
        return true;
      }
      return false;
    }

    // half-open: cho phép thử
    return true;
  }

  /** Gọi khi provider trả về thành công */
  recordSuccess(providerName) {
    const s = this._get(providerName);
    s.failures = 0;
    s.state = "closed";
    s.openedAt = null;
  }

  /** Gọi khi provider lỗi */
  recordFailure(providerName) {
    const s = this._get(providerName);
    s.failures += 1;

    if (s.state === "half-open") {
      // Thử lại ở half-open mà vẫn lỗi -> mở lại ngay, kéo dài cooldown
      s.state = "open";
      s.openedAt = Date.now();
      return;
    }

    if (s.failures >= this.failureThreshold) {
      s.state = "open";
      s.openedAt = Date.now();
    }
  }

  getStatus(providerName) {
    const s = this._get(providerName);
    return { ...s };
  }

  getAllStatus() {
    const result = {};
    for (const [name, s] of this.states.entries()) {
      result[name] = { ...s };
    }
    return result;
  }
}

module.exports = { CircuitBreaker };
