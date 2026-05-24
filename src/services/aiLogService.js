const { EventEmitter } = require("events");

const MAX_LOGS = 300;
const VALID_STATUSES = new Set(["started", "progress", "success", "error"]);
const events = new EventEmitter();

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

function listAiLogs({ limit = 100, status = "", type = "" } = {}) {
  const max = Math.max(1, Math.min(Number.parseInt(limit, 10) || 100, MAX_LOGS));
  const statusFilter = safeText(status, 40);
  const typeFilter = safeText(type, 80).toLowerCase();
  return logs
    .filter((log) => !statusFilter || log.status === statusFilter)
    .filter((log) => !typeFilter || String(log.type || "").toLowerCase() === typeFilter)
    .slice(0, max);
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
  clearAiLogs,
  subscribeAiLogs
};