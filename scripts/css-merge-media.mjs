#!/usr/bin/env node
/**
 * Phase 4 (docs/refactor-plan.md): dời + gộp mọi khối @media của public/style.css
 * xuống cuối file — MỖI điều kiện còn đúng MỘT khối, thứ tự rộng → hẹp, cuối cùng là
 * prefers-reduced-motion. Nội dung bên trong các khối được nối theo thứ tự xuất hiện
 * trong file gốc (bảo toàn cascade nội bộ). KHÔNG đổi/di chuyển rule top-level.
 *
 * Các chỉnh tay sau đó (sidebar hợp nhất, xoá khai báo chết) làm bằng edit riêng
 * để diff dễ soát — xem docs/REFACTOR_NOTES.md Phase 4.
 *
 * Chạy: node scripts/css-merge-media.mjs   (ghi đè public/style.css)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "public", "style.css");
const raw = fs.readFileSync(FILE, "utf8");

// Mask comment để scan ngoặc chính xác, nhưng slice trên RAW để giữ nguyên comment/format.
const masked = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

const mediaBlocks = []; // {cond, start, open, close} — vị trí trên raw
let i = 0;
while (i < masked.length) {
  const open = masked.indexOf("{", i);
  if (open < 0) break;
  const preludeStart = i + Math.max(0, masked.slice(i, open).search(/\S/));
  const prelude = masked.slice(i, open).trim();
  let depth = 1;
  let j = open + 1;
  while (j < masked.length && depth > 0) {
    if (masked[j] === "{") depth++;
    else if (masked[j] === "}") depth--;
    j++;
  }
  if (prelude.startsWith("@media")) {
    const cond = prelude.replace(/^@media\s*/, "").replace(/\s+/g, " ").trim();
    mediaBlocks.push({ cond, start: preludeStart, open, close: j - 1 });
  }
  i = j;
}

console.log(`Tìm thấy ${mediaBlocks.length} khối @media.`);

// Gom nội dung theo điều kiện, theo thứ tự file
const ORDER = [
  "(min-width: 901px)",
  "(max-width: 1180px)",
  "(max-width: 960px)",
  "(max-width: 900px)",
  "(max-width: 768px)",
  "(max-width: 640px)",
  "(max-width: 560px)",
  "(prefers-reduced-motion: reduce)"
];
const byCond = new Map();
for (const b of mediaBlocks) {
  if (!byCond.has(b.cond)) byCond.set(b.cond, []);
  // inner: giữ nguyên raw (kể cả newline đầu/cuối), trim mép cho sạch khi nối
  byCond.get(b.cond).push(raw.slice(b.open + 1, b.close).replace(/^\n+/, "").replace(/\s+$/, ""));
}
for (const cond of byCond.keys()) {
  if (!ORDER.includes(cond)) {
    console.error(`Điều kiện chưa có trong ORDER: ${cond}`);
    process.exit(1);
  }
}

// Cắt các khối media khỏi thân file (cắt từ sau về trước để offset không lệch)
let body = raw;
for (const b of [...mediaBlocks].sort((a, z) => z.start - a.start)) {
  body = body.slice(0, b.start) + body.slice(b.close + 1);
}
// Dọn dòng trống thừa do cắt
body = body.replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "\n");

const parts = [body];
parts.push(
  "\n/* ============================================================\n" +
    "   RESPONSIVE — mỗi breakpoint đúng MỘT khối, thứ tự rộng → hẹp.\n" +
    "   Gộp từ 21 khối rải rác (refactor Phase 4 — docs/refactor-plan.md).\n" +
    "   Thêm rule responsive mới: đặt vào ĐÚNG khối breakpoint dưới đây.\n" +
    "   ============================================================ */\n"
);
for (const cond of ORDER) {
  const chunks = byCond.get(cond);
  if (!chunks) continue;
  parts.push(`\n@media ${cond} {\n${chunks.join("\n\n")}\n}\n`);
}

const out = parts.join("");
fs.writeFileSync(FILE, out);

const openCount = (out.match(/{/g) || []).length;
const closeCount = (out.match(/}/g) || []).length;
console.log(`Đã ghi ${out.split("\n").length} dòng. Ngoặc: ${openCount} mở / ${closeCount} đóng.`);
