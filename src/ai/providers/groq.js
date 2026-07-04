/**
 * groq.js
 * Adapter cho Groq - API tương thích chuẩn OpenAI Chat Completions.
 */

const { fetchWithTimeout } = require("./httpUtil");

async function chat(messages, { model = "meta-llama/llama-4-scout-17b-16e-instruct", apiKey } = {}) {
  const res = await fetchWithTimeout("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages }),
  }, 15000);

  if (!res.ok) {
    const err = new Error(`Groq error: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    const err = new Error("Groq: empty response");
    err.status = 500;
    throw err;
  }
  return text;
}

module.exports = { name: "groq", chat };
