#!/usr/bin/env node
/**
 * Lint chống lỗi Nunjucks array-truthiness (docs/refactor-plan.md — Phase 1).
 *
 * Trong Nunjucks, mảng rỗng [] là truthy nên `{% if items %}` KHÔNG gate được
 * empty-state — phải viết `{% if items|length %}`. Script này quét views/**\/*.html:
 *
 * - VI PHẠM (exit 1): `{% if X %}` / `{% elif X %}` / `{% if not X %}` với X là biến
 *   đơn (kể cả dạng a.b.c) nằm trong registry biến-mảng scripts/template-array-vars.json
 *   (khớp tên đầy đủ hoặc segment cuối).
 * - CẢNH BÁO (không fail): biến đơn ngoài registry nhưng tên có hậu tố kiểu mảng
 *   (*s, *List, *Items, *Array) và không nằm trong danh sách allow.
 * - Bỏ qua có chủ đích: thêm comment `{# lint-ok #}` trên cùng dòng, hoặc thêm tên
 *   vào "allow" trong JSON.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIEWS_DIR = path.join(ROOT, "views");
const REGISTRY_PATH = path.join(ROOT, "scripts", "template-array-vars.json");

const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
const ARRAY_VARS = new Set(registry.arrays || []);
const ALLOW = new Set(registry.allow || []);

/** Hậu tố gợi ý "đây có thể là mảng" cho biến chưa có trong registry. */
const SUFFIX_HEURISTIC = /(s|List|Items|Array)$/;

// {% if X %} | {% elif X %} | {% if not X %} — X = identifier có thể chấm (a.b.c)
const TAG_RE = /\{%[-\s]*(if|elif)\s+(not\s+)?([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)\s*[-\s]*%\}/g;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith(".html")) yield full;
  }
}

function lastSegment(name) {
  const parts = name.split(".");
  return parts[parts.length - 1];
}

const violations = [];
const warnings = [];

for (const file of walk(VIEWS_DIR)) {
  const rel = path.relative(ROOT, file).replaceAll("\\", "/");
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (line.includes("{# lint-ok #}")) return;
    for (const m of line.matchAll(TAG_RE)) {
      const name = m[3];
      const seg = lastSegment(name);
      if (ALLOW.has(name) || ALLOW.has(seg)) continue;
      const loc = `${rel}:${idx + 1}`;
      const shown = m[0].trim();
      if (ARRAY_VARS.has(name) || ARRAY_VARS.has(seg)) {
        violations.push(`${loc}  ${shown}  → biến-mảng, phải dùng "${name}|length" (hoặc {# lint-ok #} nếu cố ý)`);
      } else if (SUFFIX_HEURISTIC.test(seg)) {
        warnings.push(`${loc}  ${shown}  → tên giống mảng; nếu đúng là mảng: thêm vào scripts/template-array-vars.json + dùng |length; nếu không: thêm vào "allow"`);
      }
    }
  });
}

if (warnings.length) {
  console.warn(`\n[lint-templates] ${warnings.length} cảnh báo (không fail):`);
  for (const w of warnings) console.warn("  WARN  " + w);
}

if (violations.length) {
  console.error(`\n[lint-templates] ${violations.length} vi phạm array-truthiness:`);
  for (const v of violations) console.error("  FAIL  " + v);
  console.error('\nNunjucks coi [] là truthy — gate mảng phải dùng "|length". Xem docs/refactor-plan.md Phase 1.');
  process.exit(1);
}

console.log(`[lint-templates] OK — không có vi phạm (${warnings.length} cảnh báo).`);
