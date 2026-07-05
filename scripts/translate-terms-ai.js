/**
 * translate-terms-ai.js — Dịch definition_vi cho một file <domain>-terms.json bằng API AI của FTKA
 * (multi-provider: Gemini/Groq/… — KHÔNG dùng Claude sub-agent). Nguồn dịch: gloss_en (ưu tiên)
 * hoặc korean. Gộp batch để giảm số call; CHECKPOINT sau mỗi batch nên DỪNG/HẾT QUOTA vẫn resume.
 *
 * Chạy:  node scripts/translate-terms-ai.js data/auto-terms.json [--batch 20] [--limit N]
 *   Chạy lại = tiếp tục các mục definition_vi còn trống. An toàn khi chạy song song 1 bản duy nhất.
 */
require("dotenv").config();
const fs = require("fs");
const ai = require("../src/services/aiService");

const FILE = process.argv[2] || "data/auto-terms.json";
const batchArg = process.argv.indexOf("--batch");
const BATCH = batchArg >= 0 ? Number(process.argv[batchArg + 1]) : 20;
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity;

const SYSTEM =
  "Bạn là dịch giả kỹ thuật (cơ khí, ô tô, và thuật ngữ chuyên ngành nói chung) Anh/Hàn → Việt. " +
  "Dịch chính xác, ngắn gọn, dùng thuật ngữ tiếng Việt chuẩn; giữ nguyên ký hiệu/đơn vị/tên riêng khi hợp lý. CHỈ trả JSON.";

function buildPrompt(items) {
  const lines = items.map((t, i) => `${i + 1}. ${t.gloss_en || t.korean}${t.gloss_en && t.korean ? `  (KO: ${t.korean})` : ""}`).join("\n");
  return (
    `Dịch sang tiếng Việt ${items.length} thuật ngữ kỹ thuật sau (GIỮ NGUYÊN thứ tự).\n` +
    `Trả JSON đúng dạng: {"vi": ["bản dịch 1", ...]} — mảng ĐÚNG ${items.length} phần tử.\n\n` +
    lines
  );
}

// Dịch 1 batch → mảng string cùng độ dài; lệch/hỏng → tách đôi đệ quy; 1 phần tử lỗi → ném.
async function translateBatch(items) {
  if (!items.length) return [];
  try {
    const res = await ai.generateJsonObject(SYSTEM, buildPrompt(items), { type: "term_translate", temperature: 0.2, maxTokens: 4096 });
    const arr = Array.isArray(res.vi) ? res.vi : null;
    if (!arr || arr.length !== items.length) throw new Error(`lệch: cần ${items.length}, nhận ${arr ? arr.length : "?"}`);
    return arr.map((s) => String(s || "").trim());
  } catch (err) {
    if (items.length === 1) throw err;
    const mid = Math.floor(items.length / 2);
    const left = await translateBatch(items.slice(0, mid));
    const right = await translateBatch(items.slice(mid));
    return [...left, ...right];
  }
}

async function main() {
  const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const todo = [];
  for (let i = 0; i < data.length; i += 1) {
    if (!String(data[i].definition_vi || "").trim() && (String(data[i].gloss_en || "").trim() || String(data[i].korean || "").trim())) todo.push(i);
    if (todo.length >= LIMIT) break;
  }
  console.log(`File ${FILE} | tổng ${data.length} | CẦN DỊCH ${todo.length} (batch=${BATCH})`);

  let done = 0, failed = 0;
  const t0 = Date.now();
  for (let b = 0; b < todo.length; b += BATCH) {
    const idxs = todo.slice(b, b + BATCH);
    let out;
    try {
      out = await translateBatch(idxs.map((i) => data[i]));
    } catch (err) {
      failed += idxs.length;
      console.log(`  batch @${b}: LỖI ${String(err.message).slice(0, 50)} — bỏ qua`);
      continue;
    }
    idxs.forEach((i, k) => { if (out[k]) { data[i].definition_vi = out[k]; done += 1; } });
    fs.writeFileSync(FILE, JSON.stringify(data), "utf8"); // checkpoint
    if ((b / BATCH) % 20 === 0 || b + BATCH >= todo.length) {
      const rate = done / ((Date.now() - t0) / 1000);
      console.log(`  ${b + idxs.length}/${todo.length} (${Math.round(((b + idxs.length) / todo.length) * 100)}%) · dịch ${done} · ${rate.toFixed(1)}/s`);
    }
  }
  console.log(`XONG. Dịch thêm ${done}, lỗi ${failed}, ${((Date.now() - t0) / 1000 / 60).toFixed(1)} phút.`);
}

main().catch((e) => { console.error(e && e.stack ? e.stack : String(e)); process.exit(1); });
