/**
 * cloudflare.js
 * Adapter cho Cloudflare Workers AI.
 */

const fetch = global.fetch || require("node-fetch");

async function chat(messages, { model = "@cf/meta/llama-3.1-8b-instruct", apiKey, accountId } = {}) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ messages }),
  });

  if (!res.ok) {
    const err = new Error(`Cloudflare Workers AI error: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data?.result?.response;
  if (!text) {
    const err = new Error("Cloudflare Workers AI: empty response");
    err.status = 500;
    throw err;
  }
  return text;
}

module.exports = { name: "cloudflare", chat };
