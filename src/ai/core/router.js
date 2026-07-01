/**
 * router.js
 * FTKA API Router - bộ não trung tâm điều phối request đến các provider AI.
 *
 * Tích hợp 5 chiến lược tối ưu:
 * 1. Định tuyến thông minh theo loại tác vụ (taskType)
 * 2. Model tiering (light/heavy) theo độ phức tạp câu hỏi
 * 3. Race mode - gọi song song nhiều provider khi cần tốc độ tối đa
 * 4. Circuit breaker - tự động bỏ qua provider đang lỗi liên tục
 * 5. Session affinity - giữ nguyên provider trong 1 phiên hội thoại
 *
 * Ngoài ra còn có: cache kết quả, theo dõi quota, retry cho lỗi tạm thời (429).
 */

const { PROVIDERS_CONFIG, DEFAULT_FALLBACK_ORDER, TASK_TYPES, MODEL_TIER } = require("./providerConfig");
const { CircuitBreaker } = require("./circuitBreaker");
const { QuotaTracker } = require("./quotaTracker");
const { ResponseCache } = require("./responseCache");
const { SessionAffinity } = require("./sessionAffinity");

const adapters = {
  google: require("../providers/google"),
  groq: require("../providers/groq"),
  nvidia: require("../providers/nvidia"),
  cloudflare: require("../providers/cloudflare"),
  openrouter: require("../providers/openrouter"),
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class FTKARouter {
  /**
   * apiKeys: { google, groq, nvidia, cloudflare, openrouter, cloudflareAccountId }
   * quotaLimits: xem QuotaTracker
   */
  constructor({ apiKeys, quotaLimits = {}, circuitBreakerOptions = {}, cacheOptions = {} } = {}) {
    this.apiKeys = apiKeys || {};
    this.circuitBreaker = new CircuitBreaker(circuitBreakerOptions);
    this.quotaTracker = new QuotaTracker(quotaLimits);
    this.cache = new ResponseCache(cacheOptions);
    this.sessionAffinity = new SessionAffinity();
  }

  /** Xác định độ phức tạp câu hỏi để chọn tier (light/heavy) */
  _estimateComplexity(messages) {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const text = lastUserMsg?.content || "";
    const length = text.length;

    // Quy tắc đơn giản: câu dài hoặc nhiều dấu câu phức tạp -> heavy
    const isLong = length > 200;
    const hasComplexPunctuation = /[;:()]/.test(text) || text.split(/[.!?]/).length > 3;

    return isLong || hasComplexPunctuation ? MODEL_TIER.HEAVY : MODEL_TIER.LIGHT;
  }

  /** Xây danh sách provider theo thứ tự ưu tiên cho 1 taskType, có áp dụng session affinity */
  _buildProviderOrder(taskType, sessionId) {
    const preferred = Object.values(PROVIDERS_CONFIG)
      .filter((p) => p.taskPriority.includes(taskType))
      .map((p) => p.name);

    const rest = DEFAULT_FALLBACK_ORDER.filter((name) => !preferred.includes(name));
    let order = [...preferred, ...rest];

    // Session affinity: nếu phiên này từng dùng 1 provider thành công, đẩy lên đầu
    const affinityProvider = this.sessionAffinity.get(sessionId);
    if (affinityProvider && order.includes(affinityProvider)) {
      order = [affinityProvider, ...order.filter((n) => n !== affinityProvider)];
    }

    return order;
  }

  /** Lọc ra các provider đang khả dụng: chưa bị circuit breaker mở, còn quota */
  _filterAvailable(providerNames) {
    return providerNames.filter(
      (name) => this.circuitBreaker.isAvailable(name) && this.quotaTracker.hasQuota(name)
    );
  }

  _getModelForTier(providerName, tier) {
    const config = PROVIDERS_CONFIG[providerName];
    return config.models[tier] || config.models.light;
  }

  /** Gọi 1 provider, có retry 1 lần nếu lỗi 429 (rate limit tạm thời) */
  async _callProvider(providerName, messages, tier) {
    const adapter = adapters[providerName];
    const model = this._getModelForTier(providerName, tier);
    const options = {
      model,
      apiKey: this.apiKeys[providerName],
      accountId: this.apiKeys.cloudflareAccountId, // chỉ dùng cho cloudflare
    };

    try {
      const result = await adapter.chat(messages, options);
      this.quotaTracker.recordUsage(providerName);
      this.circuitBreaker.recordSuccess(providerName);
      return result;
    } catch (e) {
      if (e.status === 429) {
        await sleep(1000);
        try {
          const result = await adapter.chat(messages, options);
          this.quotaTracker.recordUsage(providerName);
          this.circuitBreaker.recordSuccess(providerName);
          return result;
        } catch (e2) {
          this.circuitBreaker.recordFailure(providerName);
          throw e2;
        }
      }
      this.circuitBreaker.recordFailure(providerName);
      throw e;
    }
  }

  /**
   * Chế độ fallback tuần tự: thử từng provider theo thứ tự cho đến khi thành công.
   */
  async _chatSequential(messages, taskType, tier, sessionId) {
    const order = this._filterAvailable(this._buildProviderOrder(taskType, sessionId));

    if (order.length === 0) {
      throw new Error("Không còn provider nào khả dụng (tất cả đang bị circuit breaker hoặc hết quota)");
    }

    const errors = [];
    for (const providerName of order) {
      try {
        const result = await this._callProvider(providerName, messages, tier);
        this.sessionAffinity.set(sessionId, providerName);
        return { result, provider: providerName };
      } catch (e) {
        errors.push(`${providerName}: ${e.message}`);
      }
    }

    throw new Error(`Tất cả provider đều thất bại:\n${errors.join("\n")}`);
  }

  /**
   * Chế độ race: gọi song song N provider nhanh nhất, lấy kết quả về trước.
   * Dùng cho các request ưu tiên độ trễ thấp (vd: trả lời trực tiếp trong hội thoại).
   */
  async _chatRace(messages, taskType, tier, sessionId, raceCount = 2) {
    const order = this._filterAvailable(this._buildProviderOrder(taskType, sessionId));
    const candidates = order.slice(0, Math.max(1, raceCount));

    if (candidates.length === 0) {
      throw new Error("Không còn provider nào khả dụng cho race mode");
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let failCount = 0;
      const errors = [];

      candidates.forEach((providerName) => {
        this._callProvider(providerName, messages, tier)
          .then((result) => {
            if (!settled) {
              settled = true;
              this.sessionAffinity.set(sessionId, providerName);
              resolve({ result, provider: providerName });
            }
          })
          .catch((e) => {
            failCount += 1;
            errors.push(`${providerName}: ${e.message}`);
            if (failCount === candidates.length && !settled) {
              reject(new Error(`Race mode: tất cả provider thất bại:\n${errors.join("\n")}`));
            }
          });
      });
    });
  }

  /**
   * Hàm chính để gọi từ bên ngoài.
   *
   * @param {Array} messages - mảng tin nhắn [{role, content}]
   * @param {Object} options
   *   - taskType: TASK_TYPES.TRANSLATE | GRAMMAR | TOPIK_ANSWER | SIMPLE
   *   - sessionId: id phiên hội thoại (cho session affinity)
   *   - mode: "sequential" (mặc định) | "race"
   *   - raceCount: số provider gọi song song khi mode = race
   *   - useCache: true/false (mặc định true)
   *   - forceTier: ép buộc dùng "light" hoặc "heavy" thay vì auto-detect
   */
  async chat(messages, options = {}) {
    const {
      taskType = TASK_TYPES.SIMPLE,
      sessionId = null,
      mode = "sequential",
      raceCount = 2,
      useCache = true,
      forceTier = null,
    } = options;

    // 1. Kiểm tra cache trước
    if (useCache) {
      const cached = this.cache.get(messages, taskType);
      if (cached) {
        return { text: cached, provider: "cache", cached: true };
      }
    }

    // 2. Xác định tier (model tiering)
    const tier = forceTier || this._estimateComplexity(messages);

    // 3. Gọi theo mode tương ứng
    const { result, provider } =
      mode === "race"
        ? await this._chatRace(messages, taskType, tier, sessionId, raceCount)
        : await this._chatSequential(messages, taskType, tier, sessionId);

    // 4. Lưu cache
    if (useCache) {
      this.cache.set(messages, taskType, result);
    }

    return { text: result, provider, cached: false, tier };
  }

  /**
   * Gọi ĐÚNG 1 provider ở 1 tier cụ thể (dùng cho chuỗi fallback cố định FALLBACK_CHAIN).
   * Tôn trọng circuit breaker + quota; ném lỗi nếu provider không khả dụng hoặc thất bại
   * (để caller chuyển sang bước kế tiếp trong chuỗi).
   */
  async callStep(providerName, tier, messages) {
    if (!adapters[providerName]) throw new Error(`${providerName}: không có adapter`);
    if (!this.apiKeys[providerName]) throw new Error(`${providerName}: chưa cấu hình API key`);
    if (providerName === "cloudflare" && !this.apiKeys.cloudflareAccountId) {
      throw new Error("cloudflare: thiếu accountId");
    }
    if (!this.circuitBreaker.isAvailable(providerName)) throw new Error(`${providerName}: circuit breaker đang mở`);
    if (!this.quotaTracker.hasQuota(providerName)) throw new Error(`${providerName}: hết quota`);
    // _callProvider tự retry 429 1 lần + ghi nhận success/failure + quota.
    const text = await this._callProvider(providerName, messages, tier);
    return { text, provider: providerName, tier };
  }

  /** Trạng thái hệ thống - hữu ích cho dashboard/debug */
  getSystemStatus() {
    return {
      circuitBreaker: this.circuitBreaker.getAllStatus(),
      quota: DEFAULT_FALLBACK_ORDER.reduce((acc, name) => {
        acc[name] = this.quotaTracker.getRemaining(name);
        return acc;
      }, {}),
    };
  }
}

module.exports = { FTKARouter, TASK_TYPES, MODEL_TIER };
