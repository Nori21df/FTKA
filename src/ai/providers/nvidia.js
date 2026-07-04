/**
 * nvidia.js
 * Adapter cho NVIDIA NIM - API tương thích OpenAI Chat Completions.
 */

const { fetchWithTimeout } = require("./httpUtil");

async function chat(messages, { model = "openai/gpt-oss-120b", apiKey } = {}) {
  const res = await fetchWithTimeout("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages }),
  }, 25000);

  if (!res.ok) {
    const err = new Error(`NVIDIA NIM error: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) {
    const err = new Error("NVIDIA NIM: empty response");
    err.status = 500;
    throw err;
  }
  return text;
}

module.exports = { name: "nvidia", chat };
