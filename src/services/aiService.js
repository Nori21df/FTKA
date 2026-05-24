const env = require("../config/env");

function requireApiKey() {
  if (!env.googleAiStudioApiKey) {
    throw new Error("GOOGLE_AI_STUDIO_API_KEY is not set on the server.");
  }
}

function googleGenerateUrl() {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.googleAiStudioModel)}:generateContent?key=${encodeURIComponent(env.googleAiStudioApiKey)}`;
}

function googleBody(system, prompt, { temperature = 0.3, maxTokens = 2048 } = {}) {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      responseMimeType: "application/json"
    }
  };
}

function extractGoogleText(payload) {
  return payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
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
  throw new Error(`Google AI Studio error ${lastStatus}: ${lastText}`);
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

async function chatJson(system, prompt, { temperature = 0.3, maxTokens = 2048 } = {}) {
  requireApiKey();
  const { bodyText } = await fetchGoogleWithRetry(googleBody(system, prompt, { temperature, maxTokens }));
  const payload = JSON.parse(bodyText);
  const content = extractGoogleText(payload);
  try {
    return JSON.parse(extractJsonText(content));
  } catch (error) {
    throw new Error(`AI returned invalid JSON: ${String(content).slice(0, 500)}`);
  }
}

async function testConnection() {
  requireApiKey();
  await fetchGoogleWithRetry(googleBody("You are a helpful assistant.", "Reply with exactly OK as JSON string.", { maxTokens: 16 }), 2);
  return true;
}

async function generateVocabularyBatch(count, existingWords = [], topic = "") {
  const exclusion = existingWords.length ? `Do NOT generate these words: ${existingWords.slice(-500).join(", ")}.\n` : "";
  return chatJson(
    "You are a careful Korean language teacher for Vietnamese learners. Return only valid JSON, never markdown. All *_vi fields must be natural Vietnamese.",
    `Generate ${count} unique TOPIK Korean vocabulary words relevant to: "${topic}".\n${exclusion}
Reply ONLY with a JSON array. Each object must have these keys:
[{"korean":"...","meaning_vi":"...","explanation_vi":"...","example_kr":"...","example_vi":"...","tts_text":"...","quiz_type":"word"}]`,
    { temperature: 0.3, maxTokens: 2048 }
  );
}

async function translateSpecificWord(word) {
  return chatJson(
    "You are a careful Korean language teacher for Vietnamese learners. Return only one valid JSON object, never markdown.",
    `Translate and explain this Korean word or expression exactly: ${word}
Reply as JSON only with this shape:
{"korean":"${word}","meaning_vi":"...","explanation_vi":"...","example_kr":"...","example_vi":"...","tts_text":"${word}","quiz_type":"word"}`,
    { temperature: 0.45, maxTokens: 2048 }
  );
}

async function generateGrammarQuizzesBatch(grammar, count = 3) {
  const result = await chatJson(
    "You are an expert TOPIK-style Korean exam writer for Vietnamese learners. Return ONLY a valid JSON array with no markdown.",
    `Create ${count} multiple-choice fill-in-the-blank questions for this Korean grammar pattern: ${grammar}
Return a JSON array:
[{"question_kr":"... ___ ...","question_vi":"...","options":["...","...","...","..."],"correct_index":0,"correct_answer":"...","explanation_vi":"..."}]`,
    { temperature: 0.45, maxTokens: 4096 }
  );
  return Array.isArray(result) ? result : [];
}

async function generateGrammarData(pattern) {
  const result = await chatJson(
    "You are an expert Korean teacher for Vietnamese learners. Return ONLY one valid JSON object with no markdown. All *_vi fields must be natural Vietnamese.",
    `Analyze this Korean grammar pattern: ${pattern}
Return JSON with exactly these keys:
{"grammar":"...","meaning_vi":"...","explanation_vi":"...","example_kr":"...","example_vi":"...","level":"topik1|topik2|topik3|topik4|topik5|topik6","usage_notes_vi":"...","common_mistakes_vi":"...","quiz_items":[{"question_kr":"... ___ ...","question_vi":"...","options":["...","...","...","..."],"correct_index":0,"correct_answer":"...","explanation_vi":"..."}]}`,
    { temperature: 0.3, maxTokens: 2048 }
  );
  if (!Array.isArray(result.quiz_items) || result.quiz_items.length < 2) {
    result.quiz_items = await generateGrammarQuizzesBatch(result.grammar || pattern, 3);
  }
  return result;
}

async function generateJsonObject(system, prompt, options = {}) {
  const result = await chatJson(system, prompt, options);
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
