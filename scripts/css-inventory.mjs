#!/usr/bin/env node
/**
 * Inventory cho Phase 4 (docs/refactor-plan.md): phân tích public/style.css trước khi gộp
 * media query. In ra:
 *   1. Mọi khối @media: điều kiện + dòng bắt đầu + số rule.
 *   2. Selector khai báo >=2 lần trong CÙNG điều kiện breakpoint (gộp mọi khối cùng điều kiện).
 *   3. Mọi khai báo transform của .sidebar / .sidebar.is-open.
 *   4. DANGER LIST cho việc dời media xuống cuối file: cặp (selector, property) xuất hiện
 *      trong một khối @media tại dòng L1 VÀ ở top-level (ngoài media) tại dòng L2 > L1 —
 *      hiện tại bản top-level thắng nhờ source order; dời media xuống cuối sẽ ĐẢO kết quả.
 *      Những cặp này phải kiểm tra tay từng cái khi gộp.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSS = fs.readFileSync(path.join(ROOT, "public", "style.css"), "utf8");

function lineAt(pos) {
  let line = 1;
  for (let i = 0; i < pos; i++) if (CSS[i] === "\n") line++;
  return line;
}

// Bóc comment (giữ nguyên độ dài để line number đúng)
const noComments = CSS.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

// Quét block top-level bằng đếm ngoặc
const topBlocks = []; // {prelude, start, bodyStart, bodyEnd}
let i = 0;
while (i < noComments.length) {
  const open = noComments.indexOf("{", i);
  if (open < 0) break;
  const prelude = noComments.slice(i, open).trim();
  let depth = 1;
  let j = open + 1;
  while (j < noComments.length && depth > 0) {
    if (noComments[j] === "{") depth++;
    else if (noComments[j] === "}") depth--;
    j++;
  }
  topBlocks.push({ prelude, start: i + noComments.slice(i, open).search(/\S/), open, close: j - 1 });
  i = j;
}

function parseRules(bodyText, offset) {
  // parse các rule con (selector { decls }) trong một đoạn text — không xử lý @media lồng nhau (file không có)
  const rules = [];
  let k = 0;
  while (k < bodyText.length) {
    const open = bodyText.indexOf("{", k);
    if (open < 0) break;
    const selector = bodyText.slice(k, open).trim().replace(/\s+/g, " ");
    let depth = 1;
    let j = open + 1;
    while (j < bodyText.length && depth > 0) {
      if (bodyText[j] === "{") depth++;
      else if (bodyText[j] === "}") depth--;
      j++;
    }
    const body = bodyText.slice(open + 1, j - 1);
    const decls = body
      .split(";")
      .map((d) => d.trim())
      .filter((d) => d.includes(":"))
      .map((d) => ({ prop: d.slice(0, d.indexOf(":")).trim(), value: d.slice(d.indexOf(":") + 1).trim() }));
    rules.push({ selector, decls, line: lineAt(offset + k + bodyText.slice(k, open).search(/\S/)) });
    k = j;
  }
  return rules;
}

const mediaBlocks = []; // {cond, line, rules}
const topRules = []; // rule ngoài media

for (const b of topBlocks) {
  if (b.prelude.startsWith("@media")) {
    const cond = b.prelude.replace(/^@media\s*/, "").replace(/\s+/g, " ").trim();
    const body = noComments.slice(b.open + 1, b.close);
    mediaBlocks.push({ cond, line: lineAt(b.start), rules: parseRules(body, b.open + 1) });
  } else if (b.prelude.startsWith("@")) {
    // @keyframes, @font-face... bỏ qua trong phân tích selector
  } else {
    const body = noComments.slice(b.open + 1, b.close);
    const decls = body
      .split(";")
      .map((d) => d.trim())
      .filter((d) => d.includes(":"))
      .map((d) => ({ prop: d.slice(0, d.indexOf(":")).trim(), value: d.slice(d.indexOf(":") + 1).trim() }));
    topRules.push({ selector: b.prelude.replace(/\s+/g, " "), decls, line: lineAt(b.start) });
  }
}

// ── 1. Khối @media ──
console.log("== 1) KHỐI @MEDIA ==");
const byCond = new Map();
for (const m of mediaBlocks) {
  if (!byCond.has(m.cond)) byCond.set(m.cond, []);
  byCond.get(m.cond).push(m);
}
for (const [cond, blocks] of byCond) {
  console.log(`  ${cond} — ${blocks.length} khối: ${blocks.map((b) => `dòng ${b.line} (${b.rules.length} rule)`).join(", ")}`);
}

// ── 2. Selector trùng trong cùng điều kiện ──
console.log("\n== 2) SELECTOR KHAI BÁO >=2 LẦN TRONG CÙNG ĐIỀU KIỆN ==");
for (const [cond, blocks] of byCond) {
  const seen = new Map();
  for (const b of blocks) {
    for (const r of b.rules) {
      for (const sel of r.selector.split(",").map((s) => s.trim())) {
        if (!seen.has(sel)) seen.set(sel, []);
        seen.get(sel).push(r.line);
      }
    }
  }
  const dups = [...seen].filter(([, lines]) => lines.length >= 2);
  if (dups.length) {
    console.log(`  [${cond}]`);
    for (const [sel, lines] of dups) console.log(`    ${sel} — dòng ${lines.join(", ")}`);
  }
}

// ── 3. Sidebar transform ──
console.log("\n== 3) SIDEBAR TRANSFORM ==");
const allRules = [
  ...topRules.map((r) => ({ ...r, cond: "(top-level)" })),
  ...mediaBlocks.flatMap((m) => m.rules.map((r) => ({ ...r, cond: m.cond })))
];
for (const r of allRules) {
  if (!/\.sidebar(\.|\s|$|:)/.test(r.selector + " ")) continue;
  for (const d of r.decls) {
    if (d.prop === "transform") console.log(`  dòng ${r.line} [${r.cond}] ${r.selector} { transform: ${d.value} }`);
  }
}

// ── 4. DANGER LIST khi dời media xuống cuối ──
console.log("\n== 4) DANGER: (selector, prop) có trong @media VÀ ở top-level SAU khối media đó ==");
let dangerCount = 0;
for (const m of mediaBlocks) {
  for (const r of m.rules) {
    const sels = r.selector.split(",").map((s) => s.trim());
    for (const d of r.decls) {
      for (const t of topRules) {
        if (t.line <= m.line) continue; // top-level phải nằm SAU khối media mới nguy hiểm
        const tsels = t.selector.split(",").map((s) => s.trim());
        if (!sels.some((s) => tsels.includes(s))) continue;
        if (!t.decls.some((td) => td.prop === d.prop)) continue;
        dangerCount++;
        console.log(`  [${m.cond} @${m.line}] ${r.selector} { ${d.prop} } (dòng ${r.line})  <->  top-level dòng ${t.line}`);
      }
    }
  }
}
if (!dangerCount) console.log("  (không có — dời media xuống cuối an toàn về source-order với top-level)");

// ── 5. Xung đột CHÉO điều kiện: (selector, prop) trong 2 khối media có điều kiện CHỒNG NHAU ──
// (mọi max-width chồng nhau: 640 ⊂ 768 ⊂ 900 ⊂ 960 ⊂ 1180; min-901 chồng 960/1180).
// Khi gộp + sắp lại thứ tự khối, cặp nào giá trị KHÁC nhau phải giữ đúng "người thắng" hiện tại.
console.log("\n== 5) XUNG ĐỘT CHÉO ĐIỀU KIỆN (selector+prop trùng, khác giá trị) ==");
function widthOf(cond) {
  const mMax = cond.match(/max-width:\s*(\d+)/);
  const mMin = cond.match(/min-width:\s*(\d+)/);
  return { max: mMax ? Number(mMax[1]) : null, min: mMin ? Number(mMin[1]) : null };
}
function overlaps(a, b) {
  if (a === b) return false;
  const wa = widthOf(a), wb = widthOf(b);
  if (wa.max == null && wa.min == null) return false; // reduced-motion: prop khác loại, xử lý riêng
  if (wb.max == null && wb.min == null) return false;
  const loA = wa.min ?? 0, hiA = wa.max ?? Infinity;
  const loB = wb.min ?? 0, hiB = wb.max ?? Infinity;
  return Math.max(loA, loB) <= Math.min(hiA, hiB);
}
const flat = mediaBlocks.flatMap((m) =>
  m.rules.flatMap((r) =>
    r.selector.split(",").map((s) => s.trim()).flatMap((sel) =>
      r.decls.map((d) => ({ cond: m.cond, blockLine: m.line, line: r.line, sel, prop: d.prop, value: d.value }))
    )
  )
);
let crossCount = 0;
for (let a = 0; a < flat.length; a++) {
  for (let b = a + 1; b < flat.length; b++) {
    const A = flat[a], B = flat[b];
    if (A.sel !== B.sel || A.prop !== B.prop) continue;
    if (!overlaps(A.cond, B.cond)) continue;
    if (A.value === B.value) continue;
    crossCount++;
    const winner = A.line > B.line ? A : B;
    console.log(`  ${A.sel} { ${A.prop} }: [${A.cond}] dòng ${A.line} = "${A.value}"  vs  [${B.cond}] dòng ${B.line} = "${B.value}"  → hiện thắng: dòng ${winner.line}`);
  }
}
if (!crossCount) console.log("  (không có cặp khác giá trị giữa các điều kiện chồng nhau)");

console.log(`\nTổng: ${mediaBlocks.length} khối @media, ${byCond.size} điều kiện khác nhau, ${topRules.length} rule top-level.`);
