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
    // light = Gemma 4 31B (open model, gọi qua cùng endpoint generateContent)
    // heavy = Gemini 3.5 Flash (model chủ lực hiện tại của Google, GA)
    models: { light: "gemini-3.5-flash", heavy: "gemma-4-31b-it" },
  },
  groq: {
    name: "groq",
    taskPriority: [TASK_TYPES.GRAMMAR, TASK_TYPES.TOPIK_ANSWER, TASK_TYPES.SIMPLE],
    tier: MODEL_TIER.LIGHT,
    avgLatencyMs: 1000,
    // light = Llama 4 Scout (đa ngôn ngữ tốt hơn Llama 3, ~1s)
    // heavy = Llama 3.3 70B (nhanh ~1s, JSON sạch, KHÔNG có reasoning token → không đốt token/phút của Groq).
    // Lưu ý: KHÔNG dùng model reasoning cho tác vụ hàng loạt:
    //   - gpt-oss-120b: chạy được nhưng đốt nhiều reasoning token → dễ dính 429 (TPM) khi tạo lại hàng loạt,
    //     rồi rớt xuống NVIDIA nemotron rất chậm (~20s).
    //   - qwen3.6-27b: rò rỉ token <think> làm hỏng JSON.
    models: { light: "meta-llama/llama-4-scout-17b-16e-instruct", heavy: "openai/gpt-oss-120b" },
  },
  nvidia: {
    name: "nvidia",
    taskPriority: [TASK_TYPES.TRANSLATE],
    tier: MODEL_TIER.HEAVY,
    avgLatencyMs: 1500,
    // MiniMax M3: MoE 428B (~22B active), multimodal, context 1M token, free trên NVIDIA NIM
    models: { light: "openai/gpt-oss-120b", heavy: "openai/gpt-oss-120b" },
  },
  cloudflare: {
    name: "cloudflare",
    taskPriority: [TASK_TYPES.SIMPLE],
    tier: MODEL_TIER.LIGHT,
    avgLatencyMs: 600,
    models: { light: "@cf/google/gemma-4-26b-a4b-it", heavy: "@cf/openai/gpt-oss-120b" },
  },
  openrouter: {
    name: "openrouter",
    taskPriority: [], // luôn là phương án cuối, không ưu tiên tác vụ nào
    tier: MODEL_TIER.LIGHT,
    avgLatencyMs: 2000,
    // openrouter/free: KHÔNG phải 1 model cố định — đây là "Free Models Router" của
    // OpenRouter, tự động chọn 1 model free còn khả dụng phù hợp với request.
    // Ưu điểm: không cần tự cập nhật khi model free bị deprecate.
    // Nhược điểm: không kiểm soát được chính xác model nào sẽ trả lời (có thể đổi mỗi lần gọi).
    models: { light: "openrouter/free", heavy: "openrouter/free" },
  },
};

// Thứ tự fallback mặc định khi không xác định được task type
const DEFAULT_FALLBACK_ORDER = ["google", "nvidia", "groq", "cloudflare", "openrouter"];

// Chuỗi fallback CỐ ĐỊNH (không phụ thuộc taskType): thử lần lượt từng bước (provider + tier)
// tới khi có 1 bước thành công.
const FALLBACK_CHAIN = [
  { provider: "google", tier: "heavy" },
  { provider: "google", tier: "light" },
  { provider: "groq", tier: "heavy" },
  { provider: "groq", tier: "light" },
  { provider: "nvidia", tier: "heavy" },
  { provider: "cloudflare", tier: "light" },
  { provider: "openrouter", tier: "light" },
];

module.exports = { TASK_TYPES, MODEL_TIER, PROVIDERS_CONFIG, DEFAULT_FALLBACK_ORDER, FALLBACK_CHAIN };