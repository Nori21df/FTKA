/**
 * script.js
 * Test nhanh tất cả model (light + heavy) của từng provider trong FTKA Router.
 * Gọi trực tiếp từng adapter (không qua router/circuit breaker/cache) để biết
 * chính xác model nào đang hoạt động, model nào lỗi (sai tên, hết quota, thiếu key...).
 *
 * Cách chạy:
 *   node script.js
 *
 * Cần các biến môi trường (chỉ test provider nào có key):
 *   GOOGLE_API_KEY
 *   GROQ_API_KEY
 *   NVIDIA_API_KEY
 *   CLOUDFLARE_API_KEY, CLOUDFLARE_ACCOUNT_ID
 *   OPENROUTER_API_KEY
 *
 * Nếu dùng file .env, cài thêm: npm install dotenv
 */

const path = require("path");
const fs = require("fs");

/**
 * dotenv mặc định chỉ tìm .env ở process.cwd(). Nếu script được chạy từ một
 * thư mục con (vd src/ai) trong khi .env nằm ở gốc dự án, nó sẽ không tìm thấy.
 * Hàm này dò .env theo thứ tự: cwd -> thư mục chứa script.js -> các thư mục cha
 * của cả hai, dừng lại ở file đầu tiên tìm thấy.
 */
function findEnvFile() {
  const candidates = [];
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    candidates.push(path.join(dir, ".env"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dir = __dirname;
  for (let i = 0; i < 6; i += 1) {
    candidates.push(path.join(dir, ".env"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return candidates.find((p) => fs.existsSync(p)) || null;
}

let dotenvLoaded = false;
let dotenvPath = null;
try {
  const dotenv = require("dotenv");
  const foundPath = findEnvFile();
  if (foundPath) {
    const result = dotenv.config({ path: foundPath });
    if (!result.error) {
      dotenvLoaded = true;
      dotenvPath = foundPath;
    }
  }
} catch {
  // Gói dotenv chưa được cài -> bỏ qua, dùng process.env trực tiếp (vd biến đã export sẵn ở shell)
}

const { PROVIDERS_CONFIG } = require("./core/providerConfig");

const adapters = {
  google: require("./providers/google"),
  groq: require("./providers/groq"),
  nvidia: require("./providers/nvidia"),
  cloudflare: require("./providers/cloudflare"),
  openrouter: require("./providers/openrouter"),
};

const TEST_MESSAGES = [
  { role: "user", content: "Trả lời đúng 2 chữ: 'Xin chào'. Không thêm gì khác." },
];

/**
 * Dò nhiều tên biến khả dĩ cho mỗi provider — vì dự án gốc có thể đặt tên khác
 * (vd GOOGLE_AI_STUDIO_API_KEY thay vì GOOGLE_API_KEY). Ưu tiên biến đầu tiên tìm thấy.
 */
function firstDefined(...names) {
  for (const name of names) {
    if (process.env[name]) return { value: process.env[name], matchedName: name };
  }
  return { value: undefined, matchedName: null };
}

const googleKey = firstDefined("GOOGLE_API_KEY", "GOOGLE_AI_STUDIO_API_KEY", "GEMINI_API_KEY");
const groqKey = firstDefined("GROQ_API_KEY");
const nvidiaKey = firstDefined("NVIDIA_API_KEY", "NVIDIA_NIM_API_KEY");
const cloudflareKey = firstDefined("CLOUDFLARE_API_KEY", "CLOUDFLARE_WORKERS_AI_API_KEY");
const cloudflareAccountId = firstDefined("CLOUDFLARE_ACCOUNT_ID");
const openrouterKey = firstDefined("OPENROUTER_API_KEY");

const API_KEYS = {
  google: googleKey.value,
  groq: groqKey.value,
  nvidia: nvidiaKey.value,
  cloudflare: cloudflareKey.value,
  cloudflareAccountId: cloudflareAccountId.value,
  openrouter: openrouterKey.value,
};

const MATCHED_ENV_NAMES = {
  google: googleKey.matchedName,
  groq: groqKey.matchedName,
  nvidia: nvidiaKey.matchedName,
  cloudflare: cloudflareKey.matchedName,
  cloudflareAccountId: cloudflareAccountId.matchedName,
  openrouter: openrouterKey.matchedName,
};

const TIMEOUT_MS = 20_000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout sau ${ms / 1000}s`)), ms)),
  ]);
}

/** Test 1 model cụ thể của 1 provider */
async function testModel(providerName, tier, model) {
  const adapter = adapters[providerName];
  const apiKey = API_KEYS[providerName];
  const options = { model, apiKey, accountId: API_KEYS.cloudflareAccountId };

  const startedAt = Date.now();
  try {
    const text = await withTimeout(adapter.chat(TEST_MESSAGES, options), TIMEOUT_MS);
    const latencyMs = Date.now() - startedAt;
    return {
      provider: providerName,
      tier,
      model,
      status: "OK",
      latencyMs,
      preview: String(text || "").replace(/\s+/g, " ").trim().slice(0, 60),
      error: null,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    return {
      provider: providerName,
      tier,
      model,
      status: "FAIL",
      latencyMs,
      preview: null,
      error: error.message || String(error),
    };
  }
}

/** Trả về danh sách (provider, tier, model) duy nhất cần test — bỏ trùng nếu light === heavy */
function buildTestPlan() {
  const plan = [];
  for (const [providerName, config] of Object.entries(PROVIDERS_CONFIG)) {
    const seenModels = new Set();
    for (const tier of ["light", "heavy"]) {
      const model = config.models[tier];
      const dedupeKey = `${providerName}:${model}`;
      if (seenModels.has(dedupeKey)) continue;
      seenModels.add(dedupeKey);
      plan.push({ providerName, tier, model });
    }
  }
  return plan;
}

function hasRequiredKeys(providerName) {
  if (!API_KEYS[providerName]) return false;
  if (providerName === "cloudflare" && !API_KEYS.cloudflareAccountId) return false;
  return true;
}

function printResultsTable(results) {
  const colWidths = { provider: 12, tier: 7, model: 34, status: 6, latency: 9 };

  const pad = (str, width) => String(str).padEnd(width);
  const header =
    pad("Provider", colWidths.provider) +
    pad("Tier", colWidths.tier) +
    pad("Model", colWidths.model) +
    pad("Status", colWidths.status) +
    pad("Latency", colWidths.latency);
  console.log("\n" + header);
  console.log("-".repeat(header.length));

  for (const r of results) {
    const statusLabel = r.status === "OK" ? "✅ OK" : r.status === "SKIP" ? "⏭ SKIP" : "❌ FAIL";
    const latencyLabel = r.status === "SKIP" ? "-" : `${r.latencyMs}ms`;
    console.log(
      pad(r.provider, colWidths.provider) +
        pad(r.tier, colWidths.tier) +
        pad(r.model, colWidths.model) +
        pad(statusLabel, colWidths.status + 2) +
        pad(latencyLabel, colWidths.latency)
    );
    if (r.status === "OK") {
      console.log(`   → phản hồi: "${r.preview}"`);
    } else if (r.status === "FAIL") {
      console.log(`   → lỗi: ${r.error}`);
    } else if (r.status === "SKIP") {
      console.log(`   → bỏ qua: thiếu API key`);
    }
  }
}

async function main() {
  console.log("=== Trạng thái nạp biến môi trường ===");
  console.log(`dotenv: ${dotenvLoaded ? `✅ đã nạp từ ${dotenvPath}` : "⚠️  KHÔNG nạp được (chưa cài dotenv, không có file .env, hoặc chạy sai thư mục)"}`);
  console.log(`Thư mục hiện tại (cwd): ${process.cwd()}`);
  for (const [provider, matchedName] of Object.entries(MATCHED_ENV_NAMES)) {
    const found = matchedName ? `✅ ${matchedName}` : "❌ không tìm thấy biến nào phù hợp";
    console.log(`  ${provider.padEnd(20)} ${found}`);
  }
  console.log("");

  const plan = buildTestPlan();
  console.log(`Chuẩn bị test ${plan.length} model qua ${Object.keys(PROVIDERS_CONFIG).length} provider...\n`);

  const results = [];

  for (const { providerName, tier, model } of plan) {
    if (!hasRequiredKeys(providerName)) {
      results.push({ provider: providerName, tier, model, status: "SKIP", latencyMs: 0 });
      console.log(`⏭  Bỏ qua ${providerName} (${model}) — thiếu API key`);
      continue;
    }

    process.stdout.write(`⏳ Đang test ${providerName} / ${model} ... `);
    const result = await testModel(providerName, tier, model);
    console.log(result.status === "OK" ? `OK (${result.latencyMs}ms)` : `FAIL (${result.error})`);
    results.push(result);
  }

  printResultsTable(results);

  const okCount = results.filter((r) => r.status === "OK").length;
  const failCount = results.filter((r) => r.status === "FAIL").length;
  const skipCount = results.filter((r) => r.status === "SKIP").length;

  console.log(`\nTổng kết: ${okCount} OK, ${failCount} FAIL, ${skipCount} SKIP (thiếu key) / ${results.length} model.`);

  if (failCount > 0) {
    console.log("\n⚠️  Có model lỗi — kiểm tra lại tên model, API key, hoặc quota của provider tương ứng.");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Lỗi không mong muốn khi chạy script:", error);
  process.exitCode = 1;
});