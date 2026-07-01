/**
 * quotaTracker.js
 * Theo dõi số request đã dùng trong ngày/phút cho từng provider.
 * Đây là ước tính nội bộ (không gọi API kiểm tra quota thật) để Router
 * chủ động tránh provider gần hết hạn mức trước khi bị từ chối.
 */

class QuotaTracker {
  /**
   * limits: { [providerName]: { perMinute, perDay } }
   */
  constructor(limits = {}) {
    this.limits = limits;
    // usage: { [providerName]: { minuteCount, minuteResetAt, dayCount, dayResetAt } }
    this.usage = new Map();
  }

  _get(providerName) {
    if (!this.usage.has(providerName)) {
      const now = Date.now();
      this.usage.set(providerName, {
        minuteCount: 0,
        minuteResetAt: now + 60_000,
        dayCount: 0,
        dayResetAt: now + 86_400_000,
      });
    }
    return this.usage.get(providerName);
  }

  _refreshWindows(providerName) {
    const u = this._get(providerName);
    const now = Date.now();
    if (now >= u.minuteResetAt) {
      u.minuteCount = 0;
      u.minuteResetAt = now + 60_000;
    }
    if (now >= u.dayResetAt) {
      u.dayCount = 0;
      u.dayResetAt = now + 86_400_000;
    }
  }

  /** Kiểm tra còn quota hay không trước khi gọi */
  hasQuota(providerName) {
    this._refreshWindows(providerName);
    const limit = this.limits[providerName];
    if (!limit) return true; // không khai báo limit -> coi như không giới hạn

    const u = this._get(providerName);
    if (limit.perMinute && u.minuteCount >= limit.perMinute) return false;
    if (limit.perDay && u.dayCount >= limit.perDay) return false;
    return true;
  }

  /** Ghi nhận 1 request đã thực hiện */
  recordUsage(providerName) {
    this._refreshWindows(providerName);
    const u = this._get(providerName);
    u.minuteCount += 1;
    u.dayCount += 1;
  }

  getRemaining(providerName) {
    this._refreshWindows(providerName);
    const limit = this.limits[providerName] || {};
    const u = this._get(providerName);
    return {
      perMinuteRemaining: limit.perMinute ? Math.max(0, limit.perMinute - u.minuteCount) : Infinity,
      perDayRemaining: limit.perDay ? Math.max(0, limit.perDay - u.dayCount) : Infinity,
    };
  }
}

module.exports = { QuotaTracker };
