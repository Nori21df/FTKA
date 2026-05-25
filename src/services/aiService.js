const env = require("../config/env");
const aiLogService = require("./aiLogService");

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

async function loggedChatJson(type, system, prompt, options = {}) {
  return chatJson(system, prompt, { ...options, type });
}

async function withAiLogging(system, prompt, options, fn) {
  const startedAt = Date.now();
  const base = {
    type: options.type || "ai",
    model: env.googleAiStudioModel,
    user_id: options.user_id || options.userId || null,
    meta: promptMeta(prompt)
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

function googleGenerateUrl() {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.googleAiStudioModel)}:generateContent?key=${encodeURIComponent(env.googleAiStudioApiKey)}`;
}

function googleBody(system, prompt, { temperature = 0.3, maxTokens = 8192, schema } = {}) {
  const generationConfig = {
    temperature,
    maxOutputTokens: maxTokens,
    responseMimeType: "application/json"
  };
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

async function fetchGoogleWithRetry(body, attempts = 3) {
  let lastText = "";
  let lastStatus = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(googleGenerateUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const bodyText = await response.text();
    if (response.ok) return { bodyText, attempt };
    lastText = bodyText;
    lastStatus = response.status;
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
  const schema = options.schema || JSON_SCHEMAS[options.type];
  return withAiLogging(system, prompt, options, async () => {
    requireApiKey();
    let originalError;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const retryPrompt = attempt === 1 ? prompt : `${prompt}\n\nReturn ONLY valid JSON. No markdown. No explanation. Complete all brackets.`;
      const { bodyText } = await fetchGoogleWithRetry(googleBody(system, retryPrompt, { temperature, maxTokens, schema }));
      const payload = JSON.parse(bodyText);
      const finishReason = googleFinishReason(payload);
      aiLogService.addAiLog({ type: options.type || "ai", status: "progress", message: "AI finishReason", model: env.googleAiStudioModel, user_id: options.user_id || options.userId || null, meta: { ...promptMeta(prompt), finishReason, json_attempt: attempt } });
      if (finishReason === "MAX_TOKENS") throw new Error("AI response was cut off because max output tokens is too low.");
      try {
        return parseAiJson(extractGoogleText(payload));
      } catch (error) {
        if (attempt === 1) {
          originalError = error;
          aiLogService.addAiLog({ type: options.type || "ai", status: "error", message: "AI invalid JSON; retrying once", model: env.googleAiStudioModel, user_id: options.user_id || options.userId || null, error: safeError(error), meta: { ...promptMeta(prompt), finishReason, json_attempt: attempt } });
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
    const batch = await loggedChatJson(
    "vocabulary",
    "You are a careful Korean language teacher for Vietnamese learners. Return only valid JSON, never markdown. All *_vi fields must be natural Vietnamese.",
    `Generate ${batchCount} unique TOPIK Korean vocabulary words relevant to: "${topic}".\n${exclusion}
Reply ONLY with a JSON array. Each object must have these keys:
[{"korean":"...","meaning_vi":"...","explanation_vi":"...","example_kr":"...","example_vi":"...","tts_text":"...","quiz_type":"word"}]`,
    { temperature: 0.3, maxTokens: 8192, type: "vocabulary" }
    );
    out.push(...(Array.isArray(batch) ? batch : []));
  }
  return out.slice(0, total);
}

async function translateSpecificWord(word) {
  return loggedChatJson(
    "translate",
    "You are a careful Korean language teacher for Vietnamese learners. Return only one valid JSON object, never markdown.",
    `Translate and explain this Korean word or expression exactly: ${word}
Reply as JSON only with this shape:
{"korean":"${word}","meaning_vi":"...","explanation_vi":"...","example_kr":"...","example_vi":"...","tts_text":"${word}","quiz_type":"word"}`,
    { temperature: 0.3, maxTokens: 4096, type: "translate" }
  );
}

async function generateGrammarQuizzesBatch(grammar, count = 3) {
  const result = await loggedChatJson(
    "grammar_quiz",
    "You are an expert TOPIK-style Korean exam writer for Vietnamese learners. Return ONLY a valid JSON array with no markdown.",
    `Create ${count} multiple-choice fill-in-the-blank questions for this Korean grammar pattern: ${grammar}
Return a JSON array:
[{"question_kr":"... ___ ...","question_vi":"...","options":["...","...","...","..."],"correct_index":0,"correct_answer":"...","explanation_vi":"..."}]`,
    { temperature: 0.3, maxTokens: 8192, type: "grammar_quiz" }
  );
  return Array.isArray(result) ? result : [];
}

async function generateGrammarData(pattern) {
  const result = await loggedChatJson(
    "grammar",
    "You are an expert Korean teacher for Vietnamese learners. Return ONLY one valid JSON object with no markdown. All *_vi fields must be natural Vietnamese.",
    `Analyze this Korean grammar pattern: ${pattern}
Return JSON with exactly these keys:
{"grammar":"...","meaning_vi":"...","explanation_vi":"...","example_kr":"...","example_vi":"...","level":"topik1|topik2|topik3|topik4|topik5|topik6","usage_notes_vi":"...","common_mistakes_vi":"...","quiz_items":[{"question_kr":"... ___ ...","question_vi":"...","options":["...","...","...","..."],"correct_index":0,"correct_answer":"...","explanation_vi":"..."}]}`,
    { temperature: 0.3, maxTokens: 12000, type: "grammar" }
  );
  if (!Array.isArray(result.quiz_items) || result.quiz_items.length < 2) {
    result.quiz_items = await generateGrammarQuizzesBatch(result.grammar || pattern, 3);
  }
  return result;
}

async function generateJsonObject(system, prompt, options = {}) {
  const result = await loggedChatJson(options.type || "json_object", system, prompt, options);
  if (!result || Array.isArray(result) || typeof result !== "object") {
    throw new Error("AI returned invalid JSON object.");
  }
  return result;
}

module.exports = {
  testConnection,
  generateVocabularyBatch,
  translateSpecificWord,
  generateGrammarData,
  generateGrammarQuizzesBatch,
  generateJsonObject
};
