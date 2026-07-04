const env = require("../config/env");
const aiLogService = require("./aiLogService");
const { FTKARouter, TASK_TYPES, MODEL_TIER } = require("../ai/core/router");
const { PROVIDERS_CONFIG, FALLBACK_CHAIN, FALLBACK_CHAIN_LIGHT } = require("../ai/core/providerConfig");
const { fetchWithTimeout } = require("../ai/providers/httpUtil");

/** Singleton router — lazily created on first use. */
let _router = null;
function getRouter() {
  if (!_router) {
    _router = new FTKARouter({
      apiKeys: {
        google: env.googleAiStudioApiKey,
        groq: env.groqApiKey,
        nvidia: env.nvidiaApiKey,
        cloudflare: env.cloudflareApiKey,
        cloudflareAccountId: env.cloudflareAccountId,
        openrouter: env.openrouterApiKey,
      },
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
  }
  return _router;
}

/**
 * Cooldown cho Google: sau khi Google trả 429 (chạm rate-limit/quota), tạm dừng gọi
 * Google trong GOOGLE_COOLDOWN_MS để không spam thêm; hết thời gian mới thử lại.
 */
const GOOGLE_COOLDOWN_MS = 2 * 60 * 1000; // 2 phút
let googleCooldownUntil = 0;              // timestamp (ms) hết cooldown; 0 = không nghỉ

function startGoogleCooldown() {
  googleCooldownUntil = Date.now() + GOOGLE_COOLDOWN_MS;
}
function googleCooldownRemainingMs() {
  return Math.max(0, googleCooldownUntil - Date.now());
}

function promptMeta(prompt) {
  const text = String(prompt == null ? "" : prompt);
  return {
    prompt_length: text.length,
    prompt_preview: text.replace(/[\r\n\t]+/g, " ").trim().slice(0, 120)
  };
}

const JSON_SCHEMAS = {
  vocabulary: {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        korean: { type: "STRING" },
        meaning_vi: { type: "STRING" },
        explanation_vi: { type: "STRING" },
        example_kr: { type: "STRING" },
        example_vi: { type: "STRING" },
        tts_text: { type: "STRING" },
        quiz_type: { type: "STRING" }
      },
      required: ["korean", "meaning_vi", "explanation_vi", "example_kr", "example_vi", "tts_text", "quiz_type"]
    }
  },
  grammar_quiz: {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        question_kr: { type: "STRING" },
        question_vi: { type: "STRING" },
        options: { type: "ARRAY", items: { type: "STRING" } },
        correct_index: { type: "INTEGER" },
        correct_answer: { type: "STRING" },
        explanation_vi: { type: "STRING" }
      },
      required: ["question_kr", "question_vi", "options", "correct_index", "correct_answer", "explanation_vi"]
    }
  },
  grammar: {
    type: "OBJECT",
    properties: {
      grammar: { type: "STRING" }, meaning_vi: { type: "STRING" }, explanation_vi: { type: "STRING" },
      example_kr: { type: "STRING" }, example_vi: { type: "STRING" }, level: { type: "STRING" },
      usage_notes_vi: { type: "STRING" }, common_mistakes_vi: { type: "STRING" }, quiz_items: { type: "ARRAY", items: { type: "OBJECT" } }
    },
    required: ["grammar", "meaning_vi", "explanation_vi", "example_kr", "example_vi", "level", "usage_notes_vi", "common_mistakes_vi", "quiz_items"]
  },
  listening: {
    type: "OBJECT",
    properties: {
      title: { type: "STRING" }, korean_text: { type: "STRING" }, vietnamese_translation: { type: "STRING" },
      vocabulary: { type: "ARRAY", items: { type: "OBJECT" } }, questions: { type: "ARRAY", items: { type: "OBJECT" } }
    },
    required: ["title", "korean_text", "vietnamese_translation", "vocabulary", "questions"]
  }
};

function safeError(error) {
  return String(error?.message || error || "AI request failed").replace(/[\r\n\t]+/g, " ").trim().slice(0, 500);
}

function providerErrorMessage(status, bodyText) {
  try {
    const parsed = JSON.parse(bodyText || "{}");
    const message = parsed?.error?.message || parsed?.message || "AI provider error";
    return `Google AI Studio error ${status}: ${String(message).slice(0, 300)}`;
  } catch {
    return `Google AI Studio error ${status}: ${String(bodyText || "AI provider error").slice(0, 300)}`;
  }
}

/** Gộp system + prompt thành 1 user message cho provider chuẩn OpenAI (không có responseSchema). */
function buildRouterPrompt(system, prompt) {
  return [
    `${system}`,
    ``,
    `${prompt}`,
    ``,
    `IMPORTANT: Return ONLY raw JSON — no markdown fences, no explanation, no extra text.`,
  ].join("\n");
}

/** Tên model cụ thể của 1 provider theo tier (dùng để hiển thị log + chọn model Google). */
function resolveModelName(provider, tier) {
  const cfg = PROVIDERS_CONFIG[provider];
  if (cfg) return cfg.models[tier] || cfg.models.light || provider;
  return provider;
}

/**
 * chatJsonWithFallback
 * Thử lần lượt theo CHUỖI CỐ ĐỊNH (FALLBACK_CHAIN), KHÔNG phụ thuộc taskType:
 *   google heavy → google light → groq heavy → groq light → nvidia → cloudflare → openrouter
 * - Bước Google: gọi trực tiếp chatJson (model Gemini có responseSchema). Bỏ qua nếu đang cooldown 429.
 * - Bước khác: gọi qua router.callStep (tôn trọng circuit breaker + quota), parse bằng parseAiJson.
 * Trả về JSON của bước ĐẦU TIÊN thành công; nếu tất cả thất bại → ném lỗi tổng hợp.
 *
 * @param {string} type    - log type / JSON_SCHEMAS key
 * @param {string} system  - system instruction
 * @param {string} prompt  - user prompt
 * @param {Object} options - temperature, maxTokens, user_id, …
 * @returns {*}           - parsed JSON value
 */
async function chatJsonWithFallback(type, system, prompt, options = {}) {
  const userId = options.user_id || options.userId || null;
  const routerMessages = [{ role: "user", content: buildRouterPrompt(system, prompt) }];
  const errors = [];

  // Thử MỘT bước provider: trả JSON đã parse hoặc NÉM lỗi. Tự log kết quả từng bước.
  async function tryStep(step) {
    const { provider, tier } = step;
    const startedAt = Date.now();

    // ── Bước Google: đường trực tiếp (Gemini có responseSchema) ──
    if (provider === "google") {
      const cd = googleCooldownRemainingMs();
      if (cd > 0) {
        aiLogService.addAiLog({
          type, provider: "google", model: resolveModelName("google", tier), status: "progress",
          message: `Bỏ qua Google (${tier}) — đang tạm nghỉ do rate-limit (còn ${Math.ceil(cd / 1000)}s)`,
          user_id: userId, meta: { ...promptMeta(prompt), google_cooldown_ms: cd },
        });
        throw new Error(`google/${tier}: cooldown ${Math.ceil(cd / 1000)}s`);
      }
      try {
        // chatJson tự log (withAiLogging) + tự bật cooldown khi gặp 429 (fetchGoogleWithRetry).
        return await chatJson(system, prompt, { ...options, type, model: resolveModelName("google", tier) });
      } catch (googleError) {
        errors.push(`google/${tier}: ${safeError(googleError)}`);
        throw googleError; // chatJson đã tự log lỗi (withAiLogging) — không log lại
      }
    }

    // ── Bước provider khác: qua router (circuit breaker + quota) ──
    try {
      const result = await getRouter().callStep(provider, tier, routerMessages);
      const model = resolveModelName(provider, tier);
      const parsed = parseAiJson(result.text); // provider fallback không có schema → strip + trích JSON
      aiLogService.addAiLog({
        type, provider, model, status: "success",
        message: `Fallback answered by ${provider} (${tier})`,
        duration_ms: Date.now() - startedAt, user_id: userId,
        meta: { ...promptMeta(prompt), provider, model, tier, fallback: true },
      });
      return parsed;
    } catch (err) {
      errors.push(`${provider}/${tier}: ${safeError(err)}`);
      aiLogService.addAiLog({
        type, provider, model: resolveModelName(provider, tier), status: "progress",
        message: `Bỏ qua ${provider} (${tier}): ${safeError(err)}`,
        duration_ms: Date.now() - startedAt, user_id: userId,
        meta: { ...promptMeta(prompt), provider, tier },
      });
      throw err;
    }
  }

  function allFailed() {
    aiLogService.addAiLog({
      type, status: "error", message: "Tất cả provider trong chuỗi fallback đều thất bại",
      user_id: userId, error: errors.join(" | ").slice(0, 500), meta: { ...promptMeta(prompt) },
    });
    return new Error("Tất cả provider đều thất bại: " + errors.join(" | "));
  }

  // ── SIMPLE (tra từ/dict): ĐUA 2 provider nhanh nhất SONG SONG, lấy câu hợp lệ ĐẦU TIÊN ──
  // Groq (~0.6s) thường thắng cả khi Google khoẻ; Google 503/treo cũng không kéo dài vì đã có
  // câu của Groq. Cả 2 hỏng → chạy tuần tự các bước còn lại của chain nhẹ. Đánh đổi: mỗi lượt
  // tra từ tốn 2 lời gọi song song (chấp nhận được vì tra từ là thao tác thủ công, tần suất thấp).
  if (options.taskType === TASK_TYPES.SIMPLE) {
    const racers = FALLBACK_CHAIN_LIGHT.slice(0, 2);
    const rest = FALLBACK_CHAIN_LIGHT.slice(2);
    try {
      return await Promise.any(racers.map((s) => tryStep(s)));
    } catch (_raceErr) {
      // AggregateError: cả 2 racer đều hỏng — lỗi đã ghi vào `errors`; rơi xuống phần còn lại
    }
    for (const step of rest) {
      try { return await tryStep(step); } catch (_e) { /* thử bước kế */ }
    }
    throw allFailed();
  }

  // ── Tác vụ khác: tuần tự theo chain nặng ──
  for (const step of FALLBACK_CHAIN) {
    try { return await tryStep(step); } catch (_e) { /* thử bước kế */ }
  }
  throw allFailed();
}

async function withAiLogging(system, prompt, options, fn) {
  const startedAt = Date.now();
  const model = options.model || env.googleAiStudioModel;
  const base = {
    type: options.type || "ai",
    provider: "google",
    model,
    user_id: options.user_id || options.userId || null,
    meta: { ...promptMeta(prompt), provider: "google", model }
  };
  aiLogService.addAiLog({ ...base, status: "started", message: "AI request started" });
  try {
    aiLogService.addAiLog({ ...base, status: "progress", message: "Calling model" });
    const result = await fn();
    aiLogService.addAiLog({ ...base, status: "success", message: "AI request completed", duration_ms: Date.now() - startedAt });
    return result;
  } catch (error) {
    aiLogService.addAiLog({ ...base, status: "error", message: "AI request failed", duration_ms: Date.now() - startedAt, error: safeError(error) });
    throw error;
  }
}

function requireApiKey() {
  if (!env.googleAiStudioApiKey) {
    throw new Error("GOOGLE_AI_STUDIO_API_KEY is not set on the server.");
  }
}

function googleGenerateUrl(model) {
  const m = model || env.googleAiStudioModel;
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(env.googleAiStudioApiKey)}`;
}

// responseSchema/responseMimeType JSON chỉ được Gemini hỗ trợ; model Gemma thì trả text thường.
function supportsSchema(model) {
  return /gemini/i.test(String(model || env.googleAiStudioModel || ""));
}

function googleBody(system, prompt, { temperature = 0.3, maxTokens = 8192, schema, jsonMode = true } = {}) {
  const generationConfig = {
    temperature,
    maxOutputTokens: maxTokens,
  };
  if (jsonMode) generationConfig.responseMimeType = "application/json";
  if (schema) generationConfig.responseSchema = schema;
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig
  };
}

function extractGoogleText(payload) {
  return payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
}

function googleFinishReason(payload) {
  return payload.candidates?.[0]?.finishReason || "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(status) {
  return status === 429 || status >= 500;
}

async function fetchGoogleWithRetry(body, attempts = 3, model, timeoutMs = 20000) {
  let lastText = "";
  let lastStatus = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // A2: trần thời gian/lần gọi — trước đây không có timeout, Google treo là request user treo vô hạn.
    // Tác vụ nhẹ (SIMPLE) dùng trần ngắn hơn để gemini treo/503 thì rớt sang Groq (~0.6s) nhanh.
    const response = await fetchWithTimeout(googleGenerateUrl(model), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }, timeoutMs);
    const bodyText = await response.text();
    if (response.ok) return { bodyText, attempt };
    lastText = bodyText;
    lastStatus = response.status;
    if (response.status === 429) {
      // Đã chạm rate-limit/quota của Google → bật cooldown 2 phút và KHÔNG retry (tránh spam).
      startGoogleCooldown();
      break;
    }
    if (!shouldRetry(response.status) || attempt === attempts) break;
    await sleep(800 * attempt);
  }
  throw new Error(providerErrorMessage(lastStatus, lastText));
}

function stripJsonFence(text) {
  return String(text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function extractJsonText(text) {
  const stripped = stripJsonFence(text);
  try {
    JSON.parse(stripped);
    return stripped;
  } catch {
    const arrayStart = stripped.indexOf("[");
    const objectStart = stripped.indexOf("{");
    const starts = [arrayStart, objectStart].filter((index) => index >= 0);
    if (!starts.length) return stripped;
    const start = Math.min(...starts);
    const end = stripped.lastIndexOf(stripped[start] === "[" ? "]" : "}");
    return end > start ? stripped.slice(start, end + 1) : stripped;
  }
}

function parseAiJson(content) {
  const text = extractJsonText(content);
  try {
    return JSON.parse(text);
  } catch (error) {
    if (/Unexpected end of JSON input|Unterminated string/i.test(error.message || "")) {
      throw new Error("AI returned incomplete JSON. Please retry with a smaller batch.");
    }
    throw new Error(`AI returned invalid JSON: ${String(content).slice(0, 500)}`);
  }
}

async function chatJson(system, prompt, options = {}) {
  const { temperature = 0.3, maxTokens = 8192 } = options;
  const model = options.model || env.googleAiStudioModel;
  const useSchema = supportsSchema(model);
  const schema = useSchema ? (options.schema || JSON_SCHEMAS[options.type]) : null;
  // Trần Google: tác vụ nhẹ (tra từ/dict) chỉ chờ 8s rồi rớt sang Groq; tác vụ nặng chờ 20s.
  const googleTimeoutMs = options.taskType === TASK_TYPES.SIMPLE ? 8000 : 20000;
  return withAiLogging(system, prompt, { ...options, model }, async () => {
    requireApiKey();
    let originalError;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const retryPrompt = attempt === 1 ? prompt : `${prompt}\n\nReturn ONLY valid JSON. No markdown. No explanation. Complete all brackets.`;
      // A5: HTTP retry 3→2 — khi Google trục trặc 5xx, thoát sang bước kế (Groq) nhanh hơn ~1 lần gọi + 1.6s ngủ.
      const { bodyText } = await fetchGoogleWithRetry(googleBody(system, retryPrompt, { temperature, maxTokens, schema, jsonMode: useSchema }), 2, model, googleTimeoutMs);
      const payload = JSON.parse(bodyText);
      const finishReason = googleFinishReason(payload);
      aiLogService.addAiLog({ type: options.type || "ai", status: "progress", message: "AI finishReason", model, user_id: options.user_id || options.userId || null, meta: { ...promptMeta(prompt), finishReason, json_attempt: attempt } });
      if (finishReason === "MAX_TOKENS") throw new Error("AI response was cut off because max output tokens is too low.");
      try {
        return parseAiJson(extractGoogleText(payload));
      } catch (error) {
        if (attempt === 1) {
          originalError = error;
          aiLogService.addAiLog({ type: options.type || "ai", status: "error", message: "AI invalid JSON; retrying once", model, user_id: options.user_id || options.userId || null, error: safeError(error), meta: { ...promptMeta(prompt), finishReason, json_attempt: attempt } });
          continue;
        }
        throw originalError || error;
      }
    }
  });
}

async function testConnection() {
  requireApiKey();
  await fetchGoogleWithRetry(googleBody("You are a helpful assistant.", "Reply with exactly OK as JSON string.", { maxTokens: 16 }), 2);
  return true;
}

async function generateVocabularyBatch(count, existingWords = [], topic = "") {
  const batchSize = 8;
  const total = Math.max(1, Number.parseInt(count, 10) || 1);
  const out = [];
  for (let offset = 0; offset < total; offset += batchSize) {
    const batchCount = Math.min(batchSize, total - offset);
    const exclusionWords = existingWords.concat(out.map((item) => item.korean).filter(Boolean));
    const exclusion = exclusionWords.length ? `Do NOT generate these words: ${exclusionWords.slice(-500).join(", ")}.\n` : "";
    const batch = await chatJsonWithFallback(
    "vocabulary",
    "You are a careful Korean language teacher for Vietnamese learners. Return only valid JSON, never markdown. All *_vi fields must be natural Vietnamese.",
    `Generate ${batchCount} unique TOPIK Korean vocabulary words relevant to: "${topic}".\n${exclusion}
Reply ONLY with a JSON array. Each object must have these keys:
[{"korean":"...","meaning_vi":"...","explanation_vi":"...","example_kr":"...","example_vi":"...","tts_text":"...","quiz_type":"word"}]`,
    { temperature: 0.3, maxTokens: 8192, type: "vocabulary", taskType: TASK_TYPES.TRANSLATE }
    );
    out.push(...(Array.isArray(batch) ? batch : []));
  }
  return out.slice(0, total);
}

async function translateSpecificWord(word) {
  return chatJsonWithFallback(
    "translate",
    "You are a careful Korean language teacher for Vietnamese learners. Return only one valid JSON object, never markdown.",
    `Translate and explain this Korean word or expression exactly: ${word}
Reply as JSON only with this shape:
{"korean":"${word}","meaning_vi":"...","explanation_vi":"...","example_kr":"...","example_vi":"...","tts_text":"${word}","quiz_type":"word"}`,
    { temperature: 0.3, maxTokens: 4096, type: "translate", taskType: TASK_TYPES.TRANSLATE }
  );
}

/**
 * Chuẩn hoá + lọc bỏ quiz ngữ pháp kém chất lượng (đặc biệt khi fallback sang model yếu):
 * - Bỏ item thiếu trường / sai cấu trúc / không có chỗ trống.
 * - Bỏ item có question_kr lẫn chữ Latin hoặc tiếng Việt (vd "ảnh hưởng" lọt vào câu Hàn) — phải thuần Hàn.
 * - Bảo đảm options phân biệt, correct_answer nằm trong options và correct_index khớp.
 */
const LATIN_OR_VIETNAMESE = /[A-Za-zÀ-ɏḀ-ỿ]/; // chữ Latin + dấu tiếng Việt
function normalizeQuizItems(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const question_kr = String(raw.question_kr == null ? "" : raw.question_kr).trim();
    const question_vi = String(raw.question_vi == null ? "" : raw.question_vi).trim();
    const explanation_vi = String(raw.explanation_vi == null ? "" : raw.explanation_vi).trim();
    let options = Array.isArray(raw.options)
      ? [...new Set(raw.options.map((o) => String(o == null ? "" : o).trim()).filter(Boolean))]
      : [];

    if (!question_kr || !question_vi) continue;          // thiếu nội dung
    if (!question_kr.includes("_")) continue;            // không có chỗ trống "___"
    if (LATIN_OR_VIETNAMESE.test(question_kr)) continue; // câu Hàn bị lẫn chữ Latin/Việt -> loại
    if (options.length < 2) continue;                    // cần tối thiểu 2 lựa chọn

    // Xác định đáp án đúng: ưu tiên correct_answer nếu nằm trong options, nếu không thì dùng correct_index.
    let correct_answer = String(raw.correct_answer == null ? "" : raw.correct_answer).trim();
    let correct_index = Number.isInteger(raw.correct_index) ? raw.correct_index : -1;
    if (correct_answer && options.includes(correct_answer)) {
      correct_index = options.indexOf(correct_answer);
    } else if (correct_index >= 0 && correct_index < options.length) {
      correct_answer = options[correct_index];
    } else {
      continue; // không xác định được đáp án đúng -> loại
    }

    out.push({ question_kr, question_vi, options, correct_index, correct_answer, explanation_vi });
  }
  return out;
}

async function generateGrammarQuizzesBatch(grammar, count = 3) {
  const result = await chatJsonWithFallback(
    "grammar_quiz",
    "You are an expert TOPIK-style Korean exam writer for Vietnamese learners. Return ONLY a valid JSON array, no markdown, no extra text.",
    `Create ${count} multiple-choice fill-in-the-blank questions to practice this Korean grammar pattern: ${grammar}

STRICT RULES:
- "question_kr" MUST be a natural Korean sentence written ENTIRELY in Korean (Hangul only). Do NOT insert any Vietnamese or English words inside the Korean sentence.
- Put exactly one blank "___" at the position where "${grammar}" (or its correct conjugated form) belongs.
- "options": exactly 4 distinct, plausible Korean choices for the blank; exactly ONE is correct.
- "correct_answer" MUST be exactly one of the "options"; "correct_index" is its 0-based position in "options".
- "question_vi" = natural Vietnamese translation of the full sentence. "explanation_vi" = Vietnamese explanation of why the answer is correct.

Return ONLY a JSON array:
[{"question_kr":"... ___ ...","question_vi":"...","options":["...","...","...","..."],"correct_index":0,"correct_answer":"...","explanation_vi":"..."}]`,
    { temperature: 0.3, maxTokens: 8192, type: "grammar_quiz", taskType: TASK_TYPES.GRAMMAR }
  );
  const raw = Array.isArray(result) ? result : [];
  const items = normalizeQuizItems(raw);
  if (raw.length !== items.length) {
    aiLogService.addAiLog({
      type: "grammar_quiz",
      status: "progress",
      message: `Đã lọc bỏ ${raw.length - items.length}/${raw.length} câu quiz kém chất lượng (lẫn chữ Latin/Việt hoặc sai cấu trúc)`,
      meta: { grammar: String(grammar).slice(0, 80), kept: items.length, total: raw.length },
    });
  }
  return items;
}

async function generateGrammarData(pattern) {
  const result = await chatJsonWithFallback(
    "grammar",
    "You are an expert Korean teacher for Vietnamese learners. Return ONLY one valid JSON object with no markdown. All *_vi fields must be natural Vietnamese.",
    `Analyze this Korean grammar pattern: ${pattern}

STRICT RULES for quiz_items:
- Each "question_kr" MUST be a natural Korean sentence written ENTIRELY in Korean (Hangul only) — never insert Vietnamese/English words inside the Korean sentence.
- Put exactly one blank "___" where the grammar belongs; "options" = 4 distinct Korean choices, exactly one correct.
- "correct_answer" MUST be one of "options"; "correct_index" is its 0-based position.

Return JSON with exactly these keys:
{"grammar":"...","meaning_vi":"...","explanation_vi":"...","example_kr":"...","example_vi":"...","level":"topik1|topik2|topik3|topik4|topik5|topik6","usage_notes_vi":"...","common_mistakes_vi":"...","quiz_items":[{"question_kr":"... ___ ...","question_vi":"...","options":["...","...","...","..."],"correct_index":0,"correct_answer":"...","explanation_vi":"..."}]}`,
    { temperature: 0.3, maxTokens: 12000, type: "grammar", taskType: TASK_TYPES.GRAMMAR }
  );
  // Provider fallback có thể trả về mảng/chuỗi thay vì object → chặn để không lưu bản ghi rỗng / TypeError.
  if (!result || Array.isArray(result) || typeof result !== "object") {
    throw new Error("AI returned invalid grammar object.");
  }
  // Lọc quiz kém chất lượng; nếu còn quá ít câu hợp lệ thì tạo lại (đã tự lọc bên trong).
  result.quiz_items = normalizeQuizItems(result.quiz_items);
  if (result.quiz_items.length < 2) {
    result.quiz_items = await generateGrammarQuizzesBatch(result.grammar || pattern, 3);
  }
  return result;
}

async function generateJsonObject(system, prompt, options = {}) {
  const result = await chatJsonWithFallback(
    options.type || "json_object",
    system,
    prompt,
    { taskType: TASK_TYPES.SIMPLE, ...options }
  );
  if (!result || Array.isArray(result) || typeof result !== "object") {
    throw new Error("AI returned invalid JSON object.");
  }
  return result;
}

// Tab "Học hôm nay": một đoạn văn tiếng Hàn ngắn + bản dịch tiếng Việt + 3 câu đọc hiểu.
async function generateDailyPassage(options = {}) {
  const topicHint = String(options.topic || "").trim();
  const system =
    "Bạn là giáo viên tiếng Hàn cho người Việt. Viết một đoạn văn tiếng Hàn ngắn, tự nhiên, " +
    "phù hợp trình độ sơ–trung cấp để học mỗi ngày, kèm bản dịch tiếng Việt sát nghĩa và câu hỏi đọc hiểu. CHỈ trả về JSON.";
  const prompt =
    `Tạo một đoạn văn tiếng Hàn để học hôm nay${topicHint ? ` về chủ đề: ${topicHint}` : ""}.\n` +
    `Yêu cầu:\n` +
    `- "title": tiêu đề ngắn bằng tiếng Hàn (Hangul).\n` +
    `- "korean": 4–6 câu tiếng Hàn tự nhiên, đời thường, viết HOÀN TOÀN bằng Hangul ` +
    `(KHÔNG chèn tiếng Việt/tiếng Anh trong câu), độ dài vừa phải cho người mới học. Ngăn câu bằng dấu xuống dòng.\n` +
    `- "vietnamese": bản dịch tiếng Việt trọn vẹn, sát nghĩa, tự nhiên; mỗi câu một dòng khớp với phần Hàn.\n` +
    `- "quiz_items": đúng 3 câu hỏi đọc hiểu VỀ NỘI DUNG đoạn văn, hỏi bằng TIẾNG VIỆT: ` +
    `{"question_vi":"...","options":["...","...","...","..."],"correct_index":0} — 4 lựa chọn tiếng Việt, đúng 1 đáp án.\n` +
    `Chỉ trả JSON đúng dạng: {"title":"...","korean":"...","vietnamese":"...","quiz_items":[...]}`;
  // taskType KHÔNG phải SIMPLE → dùng chain nặng + trần Google 20s (đoạn văn dài, chờ được model tốt;
  // vả lại đã prewarm lúc login nên không nhạy độ trễ như tra từ).
  const result = await generateJsonObject(system, prompt, { type: "daily", temperature: 0.7, maxTokens: 4096, taskType: TASK_TYPES.GRAMMAR });
  const title = String(result.title || "").trim();
  const korean = String(result.korean || "").trim();
  const vietnamese = String(result.vietnamese || "").trim();
  if (!korean || !vietnamese) {
    throw new Error("AI không tạo được đoạn văn hợp lệ, bạn thử lại nhé.");
  }
  // Quiz là phần phụ — lọc nhẹ, hỏng thì bỏ (đoạn văn vẫn dùng được).
  const quizItems = (Array.isArray(result.quiz_items) ? result.quiz_items : [])
    .filter((q) => q && typeof q.question_vi === "string" && Array.isArray(q.options) && q.options.length >= 2)
    .map((q) => ({
      question_vi: String(q.question_vi).trim(),
      options: q.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 4),
      correct_index: Number.isInteger(q.correct_index) && q.correct_index >= 0 && q.correct_index < q.options.length
        ? q.correct_index : 0
    }))
    .filter((q) => q.options.length >= 2)
    .slice(0, 3);
  return { title, korean, vietnamese, quiz_items: quizItems };
}

// Luyện viết: chấm đoạn văn tiếng Hàn của người học — điểm, bản sửa, danh sách lỗi.
async function gradeWriting(topic, text) {
  const cleanTopic = String(topic || "").trim().slice(0, 120);
  const cleanText = String(text || "").trim().slice(0, 2000);
  if (!cleanText) throw new Error("Vui lòng viết đoạn văn trước khi nộp.");
  const system =
    "Bạn là giáo viên tiếng Hàn chấm bài viết cho người Việt học sơ–trung cấp. " +
    "Chấm nhẹ nhàng, khích lệ, sửa lỗi rõ ràng. CHỈ trả về JSON.";
  const prompt =
    `Đề bài: "${cleanTopic || "tự do"}". Bài viết của học viên (tiếng Hàn):\n"""${cleanText}"""\n` +
    `Chấm bài và trả JSON:\n` +
    `{"score": 0-100 (điểm tổng),` +
    `"corrected": "toàn bộ bài đã sửa hoàn chỉnh (tiếng Hàn tự nhiên)",` +
    `"feedback_vi": "2-3 câu nhận xét tiếng Việt thân thiện, nêu điểm tốt + cần cải thiện",` +
    `"corrections": [{"wrong":"cụm sai","right":"cụm đúng","note":"giải thích ngắn tiếng Việt"}] (tối đa 8 lỗi chính)}`;
  // Chấm bài = output dài (bài sửa + nhận xét) → chain nặng + trần Google 20s, không tag SIMPLE.
  const result = await generateJsonObject(system, prompt, { type: "writing", temperature: 0.3, maxTokens: 4096, taskType: TASK_TYPES.GRAMMAR });
  const score = Math.max(0, Math.min(100, Math.round(Number(result.score) || 0)));
  const corrected = String(result.corrected || "").trim();
  const feedbackVi = String(result.feedback_vi || "").trim();
  const corrections = (Array.isArray(result.corrections) ? result.corrections : [])
    .filter((c) => c && (c.wrong || c.right))
    .map((c) => ({
      wrong: String(c.wrong || "").trim(),
      right: String(c.right || "").trim(),
      note: String(c.note || "").trim()
    }))
    .slice(0, 8);
  if (!corrected && !feedbackVi) throw new Error("AI chưa chấm được bài này, bạn thử lại nhé.");
  return { score, corrected, feedback_vi: feedbackVi, corrections };
}

// Tra từ nhanh (KHÔNG lưu vào từ điển): nghĩa + phiên âm + ví dụ ngắn.
async function lookupWord(word) {
  const clean = String(word || "").trim().slice(0, 60);
  if (!clean) throw new Error("Vui lòng nhập từ cần tra.");
  const system =
    "Bạn là từ điển Hàn-Việt. Nhận một từ/cụm tiếng Hàn (hoặc tiếng Việt cần dịch sang Hàn), " +
    "trả về nghĩa ngắn gọn chính xác. CHỈ trả JSON.";
  const prompt =
    `Tra từ: "${clean}".\n` +
    `Trả JSON: {"korean":"dạng chuẩn tiếng Hàn (Hangul)","meaning_vi":"nghĩa tiếng Việt ngắn gọn",` +
    `"reading":"phiên âm romaja","example_kr":"1 câu ví dụ tiếng Hàn ngắn","example_vi":"dịch câu ví dụ"}`;
  const result = await generateJsonObject(system, prompt, { type: "dict", temperature: 0.2, maxTokens: 1024 });
  const korean = String(result.korean || clean).trim();
  const meaning = String(result.meaning_vi || "").trim();
  if (!meaning) throw new Error("Chưa tra được từ này, bạn thử lại nhé.");
  return {
    korean,
    meaning_vi: meaning,
    reading: String(result.reading || "").trim(),
    example_kr: String(result.example_kr || "").trim(),
    example_vi: String(result.example_vi || "").trim()
  };
}

/**
 * chatWithRouter - gọi multi-provider router với AI logging.
 *
 * @param {Array}  messages  - [{role, content}]
 * @param {Object} options   - taskType, sessionId, mode, raceCount, useCache, forceTier, user_id
 * @returns {{ text, provider, cached, tier }}
 */
async function chatWithRouter(messages, options = {}) {
  const startedAt = Date.now();
  const promptText = messages.map((m) => m.content).join(" ");
  const logBase = {
    type: options.type || "router",
    model: "routing…",
    provider: "router",
    user_id: options.user_id || options.userId || null,
    meta: { ...promptMeta(promptText), taskType: options.taskType || "simple" },
  };
  aiLogService.addAiLog({ ...logBase, status: "started", message: "Router: dispatching request" });
  try {
    const result = await getRouter().chat(messages, options);

    // Resolve actual model name from providerConfig
    let resolvedModel = result.provider;
    if (result.provider && result.provider !== "cache") {
      try {
        const { PROVIDERS_CONFIG } = require("../ai/core/providerConfig");
        const cfg = PROVIDERS_CONFIG[result.provider];
        if (cfg) resolvedModel = cfg.models[result.tier] || cfg.models.light || result.provider;
      } catch { /* ignore */ }
    }

    aiLogService.addAiLog({
      ...logBase,
      model: resolvedModel,
      provider: result.provider,
      status: "success",
      message: result.cached ? "Router: served from cache" : `Router: answered by ${result.provider}`,
      duration_ms: Date.now() - startedAt,
      meta: {
        ...logBase.meta,
        provider: result.provider,
        model: resolvedModel,
        tier: result.tier || null,
        cached: result.cached || false,
      },
    });
    return result;
  } catch (error) {
    aiLogService.addAiLog({
      ...logBase,
      status: "error",
      message: "Router: all providers failed",
      duration_ms: Date.now() - startedAt,
      error: safeError(error),
    });
    throw error;
  }
}

/** Trả về trạng thái circuit breaker + quota còn lại của tất cả provider (kèm cooldown Google). */
function getRouterStatus() {
  return { ...getRouter().getSystemStatus(), googleCooldownMs: googleCooldownRemainingMs() };
}

module.exports = {
  testConnection,
  generateVocabularyBatch,
  translateSpecificWord,
  generateGrammarData,
  generateGrammarQuizzesBatch,
  generateJsonObject,
  generateDailyPassage,
  lookupWord,
  gradeWriting,
  // Multi-provider router
  chatWithRouter,
  getRouterStatus,
  TASK_TYPES,
  MODEL_TIER,
};
