const { EventEmitter } = require("events");

// Console hoạt động realtime cho trang quản trị: vòng đệm trong bộ nhớ + phát sự kiện qua SSE.
// Ghi lại request HTTP, lỗi và các sự kiện đáng chú ý để admin xem "web đang làm gì".
const MAX_ENTRIES = 400;
const VALID_LEVELS = new Set(["info", "success", "warn", "error"]);
const events = new EventEmitter();
events.setMaxListeners(50);

let entries = [];
let nextId = 1;

function safeText(value, max = 400) {
  return String(value == null ? "" : value).replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function addActivity(log = {}) {
  const entry = {
    id: nextId++,
    created_at: new Date().toISOString(),
    level: VALID_LEVELS.has(log.level) ? log.level : "info",
    category: safeText(log.category || "http", 40),
    method: safeText(log.method || "", 10),
    path: safeText(log.path || "", 200),
    status: Number.isFinite(Number(log.status)) ? Number(log.status) : null,
    duration_ms: Number.isFinite(Number(log.duration_ms)) ? Number(log.duration_ms) : null,
    user: log.user == null ? "" : safeText(log.user, 60),
    message: safeText(log.message || "", 300)
  };
  entries.unshift(entry);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(0, MAX_ENTRIES);
  events.emit("activity", entry);
  return entry;
}

function listActivity({ limit = 150, level = "", category = "" } = {}) {
  const max = Math.max(1, Math.min(Number.parseInt(limit, 10) || 150, MAX_ENTRIES));
  const levelFilter = safeText(level, 20);
  const categoryFilter = safeText(category, 40).toLowerCase();
  return entries
    .filter((e) => !levelFilter || e.level === levelFilter)
    .filter((e) => !categoryFilter || String(e.category || "").toLowerCase() === categoryFilter)
    .slice(0, max);
}

function clearActivity() {
  entries = [];
  events.emit("clear");
}

function subscribeActivity(listener) {
  const onActivity = (entry) => listener({ event: "activity", entry });
  const onClear = () => listener({ event: "clear" });
  events.on("activity", onActivity);
  events.on("clear", onClear);
  return () => {
    events.off("activity", onActivity);
    events.off("clear", onClear);
  };
}

// ── Cầu nối: đưa sự kiện AI (aiLogService) vào chung console hoạt động ──
// Chỉ lấy kết quả cuối (success/error) để tránh nhiễu bởi các bước started/progress.
try {
  const aiLogService = require("./aiLogService");
  aiLogService.subscribeAiLogs((payload) => {
    if (payload.event !== "log") return;
    const log = payload.log || {};
    if (log.status !== "success" && log.status !== "error") return;
    addActivity({
      level: log.status === "error" ? "error" : "success",
      category: "ai",
      method: log.provider || "AI",
      path: log.model ? `[${log.type}] ${log.message} · ${log.model}` : `[${log.type}] ${log.message}`,
      status: null,
      duration_ms: log.duration_ms,
      user: log.user_id == null ? "" : String(log.user_id),
      message: log.message
    });
  });
} catch { /* aiLogService không bắt buộc */ }

module.exports = { addActivity, listActivity, clearActivity, subscribeActivity };
