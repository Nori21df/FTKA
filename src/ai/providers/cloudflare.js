/**
 * cloudflare.js
 * Adapter cho Cloudflare Workers AI.
 */

const { fetchWithTimeout } = require("./httpUtil");

async function chat(messages, { model = "@cf/meta/llama-3.3-70b-instruct-fp8-fast", apiKey, accountId } = {}) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ messages }),
  }, 15000);

  if (!res.ok) {
    const err = new Error(`Cloudflare Workers AI error: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  // CF trả 2 shape tùy model: {result:{response}} (kiểu cũ) HOẶC {result:{choices:[{message}]}} (kiểu OpenAI).
  const text = data?.result?.response || data?.result?.choices?.[0]?.message?.content;
  if (!text) {
    const err = new Error("Cloudflare Workers AI: empty response");
    err.status = 500;
    throw err;
  }
  return text;
}

module.exports = { name: "cloudflare", chat };
