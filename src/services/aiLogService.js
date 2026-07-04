const { EventEmitter } = require("events");

const MAX_LOGS = 300;
const VALID_STATUSES = new Set(["started", "progress", "success", "error"]);
const events = new EventEmitter();
// Mỗi client SSE (/admin/ai-logs/stream) đăng ký 2 listener; nhiều tab admin sẽ vượt
// mặc định 10 và gây MaxListenersExceededWarning. Nâng trần cho khớp activityLogService.
events.setMaxListeners(50);

let logs = [];
let nextId = 1;

function safeText(value, max = 500) {
  return String(value == null ? "" : value).replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function safeMeta(meta = {}) {
  const blocked = /key|secret|token|password|authorization|cookie/i;
  const out = {};
  for (const [key, value] of Object.entries(meta || {})) {
    if (blocked.test(key)) continue;
    if (key === "prompt_preview") out[key] = safeText(value, 120);
    else if (key === "prompt_length") out[key] = Number(value) || 0;
    else if (typeof value === "string") out[key] = safeText(value, 300);
    else if (typeof value === "number" || typeof value === "boolean" || value == null) out[key] = value;
    else out[key] = JSON.parse(JSON.stringify(value));
  }
  return out;
}

function addAiLog(log = {}) {
  const entry = {
    id: nextId++,
    created_at: new Date().toISOString(),
    type: safeText(log.type || "ai", 80),
    status: VALID_STATUSES.has(log.status) ? log.status : "progress",
    message: safeText(log.message || "", 500),
    user_id: log.user_id == null ? null : log.user_id,
    provider: safeText(log.provider || "", 60),
    model: safeText(log.model || "", 120),
    duration_ms: Number.isFinite(Number(log.duration_ms)) ? Number(log.duration_ms) : null,
    error: log.error ? safeText(log.error, 500) : "",
    meta: safeMeta(log.meta || {})
  };
  logs.unshift(entry);
  logs = logs.slice(0, MAX_LOGS);
  events.emit("log", entry);
  return entry;
}

function listAiLogs({ limit = 100, status = "", type = "", provider = "" } = {}) {
  const max = Math.max(1, Math.min(Number.parseInt(limit, 10) || 100, MAX_LOGS));
  const statusFilter = safeText(status, 40);
  const typeFilter = safeText(type, 80).toLowerCase();
  const providerFilter = safeText(provider, 60).toLowerCase();
  return logs
    .filter((log) => !statusFilter || log.status === statusFilter)
    .filter((log) => !typeFilter || String(log.type || "").toLowerCase() === typeFilter)
    .filter((log) => !providerFilter || String(log.provider || "").toLowerCase() === providerFilter)
    .slice(0, max);
}

// Tổng hợp độ trễ theo provider từ ring buffer (cửa sổ ~300 log gần nhất). Chỉ tính các
// log có provider + duration_ms (mỗi lần gọi provider thực sự hoàn tất): success = thành công,
// còn lại (error / "Bỏ qua") = hỏng. Dùng cho bảng quan sát ở trang AI logs.
function providerStats() {
  const map = new Map();
  for (const log of logs) {
    const p = log.provider;
    if (!p || log.duration_ms == null) continue;
    if (!map.has(p)) map.set(p, { provider: p, attempts: 0, ok: 0, sumOkMs: 0, lastMs: null });
    const s = map.get(p);
    s.attempts += 1;
    if (log.status === "success") {
      s.ok += 1;
      s.sumOkMs += log.duration_ms;
      if (s.lastMs == null) s.lastMs = log.duration_ms; // logs mới nhất trước → lần thành công gần nhất
    }
  }
  return [...map.values()]
    .map((s) => ({
      provider: s.provider,
      attempts: s.attempts,
      ok: s.ok,
      avg_ms: s.ok ? Math.round(s.sumOkMs / s.ok) : null,
      success_rate: s.attempts ? Math.round((s.ok / s.attempts) * 100) : 0,
      last_ms: s.lastMs
    }))
    .sort((a, b) => (a.avg_ms == null ? Infinity : a.avg_ms) - (b.avg_ms == null ? Infinity : b.avg_ms));
}

function clearAiLogs() {
  logs = [];
  events.emit("clear");
}

function subscribeAiLogs(listener) {
  const onLog = (log) => listener({ event: "log", log });
  const onClear = () => listener({ event: "clear" });
  events.on("log", onLog);
  events.on("clear", onClear);
  return () => {
    events.off("log", onLog);
    events.off("clear", onClear);
  };
}

module.exports = {
  addAiLog,
  listAiLogs,
  providerStats,
  clearAiLogs,
  subscribeAiLogs
};