/**
 * openrouter.js
 * Adapter cho OpenRouter (free tier) - API tương thích OpenAI Chat Completions.
 */

const fetch = global.fetch || require("node-fetch");

async function chat(messages, { model = "meta-llama/llama-3.1-8b-instruct:free", apiKey } = {}) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages }),
  });

  if (!res.ok) {
    const err = new Error(`OpenRouter error: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    const err = new Error("OpenRouter: empty response");
    err.status = 500;
    throw err;
  }
  return text;
}

module.exports = { name: "openrouter", chat };
