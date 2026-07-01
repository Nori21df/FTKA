/**
 * providerConfig.js
 * Khai báo metadata cho từng provider: thế mạnh, tốc độ, độ ưu tiên theo loại tác vụ.
 * Đây là nguồn dữ liệu duy nhất (single source of truth) cho Router quyết định định tuyến.
 */

const TASK_TYPES = {
  TRANSLATE: "translate",       // Dịch Hàn-Việt
  GRAMMAR: "grammar",           // Giải thích ngữ pháp
  TOPIK_ANSWER: "topik_answer", // Trả lời học tập / tự luận TOPIK
  SIMPLE: "simple",             // Câu hỏi ngắn, từ vựng đơn giản
};

const MODEL_TIER = {
  LIGHT: "light",   // Model nhỏ, nhanh, tốn ít quota
  HEAVY: "heavy",   // Model lớn, chất lượng cao, tốn nhiều quota
};

/**
 * Mỗi provider khai báo:
 * - name: tên định danh
 * - taskPriority: tác vụ nào nên ưu tiên gọi provider này trước
 * - tier: model nhẹ hay nặng (dùng cho model tiering)
 * - avgLatencyMs: độ trễ trung bình ước tính (dùng cho race mode)
 * - models: { light, heavy } tên model cụ thể theo từng tier
 */
const PROVIDERS_CONFIG = {
  google: {
    name: "google",
    taskPriority: [TASK_TYPES.TRANSLATE, TASK_TYPES.GRAMMAR],
    tier: MODEL_TIER.HEAVY,
    avgLatencyMs: 1200,
    models: { light: "gemini-1.5-flash", heavy: "gemini-1.5-pro" },
  },
  groq: {
    name: "groq",
    taskPriority: [TASK_TYPES.GRAMMAR, TASK_TYPES.TOPIK_ANSWER, TASK_TYPES.SIMPLE],
    tier: MODEL_TIER.LIGHT,
    avgLatencyMs: 400,
    models: { light: "llama-3.1-8b-instant", heavy: "llama-3.3-70b-versatile" },
  },
  nvidia: {
    name: "nvidia",
    taskPriority: [TASK_TYPES.TRANSLATE],
    tier: MODEL_TIER.HEAVY,
    avgLatencyMs: 1500,
    models: { light: "meta/llama-3.1-8b-instruct", heavy: "meta/llama-3.1-70b-instruct" },
  },
  cloudflare: {
    name: "cloudflare",
    taskPriority: [TASK_TYPES.SIMPLE],
    tier: MODEL_TIER.LIGHT,
    avgLatencyMs: 600,
    models: { light: "@cf/meta/llama-3.1-8b-instruct", heavy: "@cf/meta/llama-3.1-8b-instruct" },
  },
  openrouter: {
    name: "openrouter",
    taskPriority: [], // luôn là phương án cuối, không ưu tiên tác vụ nào
    tier: MODEL_TIER.LIGHT,
    avgLatencyMs: 2000,
    models: { light: "meta-llama/llama-3.1-8b-instruct:free", heavy: "meta-llama/llama-3.1-8b-instruct:free" },
  },
};

// Thứ tự fallback mặc định khi không xác định được task type
const DEFAULT_FALLBACK_ORDER = ["google", "nvidia", "groq", "cloudflare", "openrouter"];

module.exports = { TASK_TYPES, MODEL_TIER, PROVIDERS_CONFIG, DEFAULT_FALLBACK_ORDER };
