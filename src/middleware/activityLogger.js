const activityLogService = require("./../services/activityLogService");

// Bỏ qua các request gây nhiễu hoặc dễ tạo vòng lặp (chính stream console, tài nguyên tĩnh…).
const SKIP_PREFIXES = ["/static", "/uploads", "/socket.io", "/favicon"];
const SKIP_EXACT = ["/admin/activity-console/stream", "/admin/ai-logs/stream"];

function levelForStatus(status) {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  if (status >= 300) return "info";
  return "success";
}

function activityLogger(req, res, next) {
  const url = req.originalUrl || req.url || "";
  const pathOnly = url.split("?")[0];
  if (SKIP_PREFIXES.some((p) => pathOnly.startsWith(p)) || SKIP_EXACT.includes(pathOnly)) {
    return next();
  }
  const startedAt = Date.now();
  res.on("finish", () => {
    try {
      activityLogService.addActivity({
        level: levelForStatus(res.statusCode),
        category: pathOnly.startsWith("/api/") ? "api" : pathOnly.startsWith("/admin") ? "admin" : "web",
        method: req.method,
        path: url.slice(0, 200),
        status: res.statusCode,
        duration_ms: Date.now() - startedAt,
        user: req.currentUser ? req.currentUser.username : "",
        message: `${req.method} ${pathOnly} → ${res.statusCode}`
      });
    } catch { /* không để logging làm hỏng request */ }
  });
  next();
}

module.exports = { activityLogger };
