/**
 * google.js
 * Adapter chuẩn hóa cho Google AI (Gemini).
 * Mọi adapter đều phải export hàm chat(messages, { model }) -> Promise<string>
 * và ném lỗi có .status khi thất bại (để Router phân biệt lỗi tạm thời/vĩnh viễn).
 */

const fetch = global.fetch || require("node-fetch");

async function chat(messages, { model = "gemini-3.5-flash", apiKey } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Gemini dùng format "contents" thay vì "messages" kiểu OpenAI
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents }),
  });

  if (!res.ok) {
    const err = new Error(`Google AI error: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const err = new Error("Google AI: empty response");
    err.status = 500;
    throw err;
  }
  return text;
}

module.exports = { name: "google", chat };
