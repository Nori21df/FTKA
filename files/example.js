/**
 * example.js
 * Ví dụ cách dùng FTKARouter cho các tình huống thực tế của FTKA.
 */

const { FTKARouter, TASK_TYPES } = require("./core/router");

const router = new FTKARouter({
  apiKeys: {
    google: process.env.GOOGLE_API_KEY,
    groq: process.env.GROQ_API_KEY,
    nvidia: process.env.NVIDIA_API_KEY,
    cloudflare: process.env.CLOUDFLARE_API_KEY,
    cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    openrouter: process.env.OPENROUTER_API_KEY,
  },
  // Quota ước tính - điều chỉnh theo gói free thực tế của từng provider
  quotaLimits: {
    google: { perMinute: 15, perDay: 1500 },
    groq: { perMinute: 30, perDay: 14400 },
    nvidia: { perMinute: 20, perDay: 1000 },
    cloudflare: { perDay: 10000 },
    openrouter: { perMinute: 10, perDay: 200 },
  },
  circuitBreakerOptions: { failureThreshold: 3, cooldownMs: 60_000 },
  cacheOptions: { ttlMs: 24 * 60 * 60 * 1000 },
});

async function main() {
  // Ví dụ 1: Dịch Hàn-Việt (ưu tiên Google, fallback NVIDIA -> Groq...)
  const translateResult = await router.chat(
    [{ role: "user", content: "Dịch sang tiếng Việt: 오늘 날씨가 정말 좋네요." }],
    { taskType: TASK_TYPES.TRANSLATE, sessionId: "user-123" }
  );
  console.log("Dịch:", translateResult.text, "| provider:", translateResult.provider);

  // Ví dụ 2: Giải thích ngữ pháp (ưu tiên Groq vì nhanh)
  const grammarResult = await router.chat(
    [{ role: "user", content: "Giải thích cấu trúc ngữ pháp '-는 김에' trong tiếng Hàn." }],
    { taskType: TASK_TYPES.GRAMMAR, sessionId: "user-123" }
  );
  console.log("Ngữ pháp:", grammarResult.text, "| provider:", grammarResult.provider);

  // Ví dụ 3: Câu hỏi cần trả lời nhanh nhất có thể -> dùng race mode
  const fastResult = await router.chat(
    [{ role: "user", content: "TOPIK II có bao nhiêu phần thi?" }],
    { taskType: TASK_TYPES.SIMPLE, mode: "race", raceCount: 2 }
  );
  console.log("Trả lời nhanh:", fastResult.text, "| provider:", fastResult.provider);

  // Kiểm tra trạng thái hệ thống (circuit breaker, quota còn lại)
  console.log("System status:", JSON.stringify(router.getSystemStatus(), null, 2));
}

main().catch(console.error);
