const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const nunjucks = require("nunjucks");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

const env = require("./config/env");
const { urlFor } = require("./utils/urls");
const { loadCurrentUser } = require("./middleware/auth");
const flash = require("./middleware/flash");
const { viewContext } = require("./middleware/viewContext");
const { activityLogger } = require("./middleware/activityLogger");
const authService = require("./services/authService");
const { createSessionStore } = require("./services/sessionStore");

const webRoutes = require("./routes/web");
const apiRoutes = require("./routes/api");
const adminRoutes = require("./routes/admin");
const paymentRoutes = require("./routes/payment.routes");
const webhookRoutes = require("./routes/webhook.routes");

if (!env.sessionSecret || env.sessionSecret === "change-me") {
  if (env.nodeEnv === "production") {
    throw new Error("SESSION_SECRET is required in production.");
  }
}

const app = express();
const viewsDir = path.join(env.rootDir, "views");
const publicDir = path.join(env.rootDir, "public");

const nunjucksEnv = nunjucks.configure(viewsDir, {
  autoescape: true,
  express: app,
  noCache: env.nodeEnv !== "production"
});

nunjucksEnv.addGlobal("url_for", urlFor);
nunjucksEnv.addFilter("tojson", (value, spaces) => {
  const json = JSON.stringify(value == null ? null : value, null, Number(spaces) || 0);
  return new nunjucks.runtime.SafeString(json.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026"));
});
nunjucksEnv.addFilter("forceescape", (value) => String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"));
nunjucksEnv.addFilter("startsWith", (value, prefix) => String(value || "").startsWith(String(prefix || "")));
// Nhãn tiếng Việt cho bài luyện nghe (thay chuỗi if/elif lặp trong template) — src/utils/labels.js
const labels = require("./utils/labels");
nunjucksEnv.addFilter("levelLabel", labels.levelLabel);
nunjucksEnv.addFilter("topicLabel", labels.topicLabel);
nunjucksEnv.addFilter("lengthLabel", labels.lengthLabel);
nunjucksEnv.addFilter("datetime", (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
});

app.set("view engine", "html");
app.set("views", viewsDir);
app.disable("x-powered-by");
app.set("trust proxy", 1);

// Origin chuẩn (từ cấu hình, KHÔNG lấy từ header client) để tránh host-header injection khi redirect.
const canonicalOrigin = (() => {
  try {
    const parsed = new URL(env.appUrl || env.baseUrl || "");
    if (parsed.protocol === "https:") return parsed.origin;
  } catch { /* cấu hình không hợp lệ → fallback bên dưới */ }
  return null;
})();

// Ép HTTP -> HTTPS khi chạy sau proxy (Cloudflare gửi header x-forwarded-proto).
// Chỉ chuyển hướng khi header nói rõ là "http"; gọi trực tiếp localhost (health-check,
// không có header này) sẽ bỏ qua để không phá vòng nội bộ.
app.use((req, res, next) => {
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (forwardedProto && forwardedProto.split(",")[0].trim() === "http") {
    const base = canonicalOrigin || `https://${req.headers.host}`;
    return res.redirect(301, base + req.originalUrl);
  }
  next();
});

app.use(helmet({
  contentSecurityPolicy: false
}));
app.use(compression());
app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
app.use(express.json({
  limit: "2mb",
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));
app.use("/static", express.static(publicDir));
app.use("/uploads", express.static(path.join(publicDir, "uploads")));

// Google Search Console: phục vụ file xác minh quyền sở hữu domain tại đường dẫn gốc
// (vd /google769af6b39f9024a7.html). basename chống path traversal, regex giới hạn tên.
app.get(/^\/google[0-9a-f]+\.html$/, (req, res, next) => {
  res.sendFile(path.join(publicDir, path.basename(req.path)), (err) => {
    if (err) next();
  });
});

// Healthcheck nhẹ (đặt trước session/log để không tốn phiên và không làm nhiễu activity log).
app.get("/healthz", (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()) });
});

// Service worker PHẢI serve từ gốc để scope phủ toàn origin (file nằm ở public/sw.js).
app.get("/sw.js", (req, res) => {
  res.sendFile(path.join(publicDir, "sw.js"));
});

// Không dùng chuỗi bí mật cố định công khai làm fallback: nếu thiếu SESSION_SECRET thì sinh
// ngẫu nhiên lúc khởi động (session sẽ mất khi restart, nhưng không thể bị giả mạo chữ ký cookie).
const sessionSecret = env.sessionSecret || crypto.randomBytes(32).toString("hex");
if (!env.sessionSecret) {
  console.warn("[session] SESSION_SECRET chưa được đặt — dùng khóa ngẫu nhiên tạm thời (đăng nhập sẽ mất khi khởi động lại).");
}

const sessionMiddleware = session({
  store: createSessionStore(),
  proxy: env.nodeEnv === "production",
  name: "ftka.sid",
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: env.sessionSameSite,
    secure: env.nodeEnv === "production",
    maxAge: env.sessionMaxAgeDays * 24 * 60 * 60 * 1000
  }
});

app.use(sessionMiddleware);

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    done(null, await authService.getUserById(id));
  } catch (error) {
    done(error);
  }
});

if (env.googleClientId && env.googleClientSecret) {
  passport.use(new GoogleStrategy({
    clientID: env.googleClientId,
    clientSecret: env.googleClientSecret,
    callbackURL: env.googleCallbackUrl
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const user = await authService.getOrCreateGoogleUser(profile);
      done(null, user);
    } catch (error) {
      done(error);
    }
  }));
}

app.use(passport.initialize());
app.use(passport.session());
app.use((req, res, next) => {
  if (req.user && !req.session.user_id) {
    authService.setSessionUser(req, req.user, "passport");
  }
  next();
});
app.use(loadCurrentUser);
app.use(flash);
app.use(viewContext);
app.use(activityLogger);

app.use("/", webhookRoutes);
app.use("/", paymentRoutes);
app.use("/api", apiRoutes);
app.use("/admin", adminRoutes);
app.use("/", webRoutes);

app.use((req, res) => {
  res.status(404);
  if (req.path.startsWith("/api/")) return res.json({ error: "Not found" });
  // render qua callback: nếu template lỗi thì fallback text, không ném ra error handler.
  return res.render("404.html", (err, html) => (err ? res.send("Not found") : res.send(html)));
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  if (req.accepts("json") && req.path.startsWith("/api/")) {
    return res.status(500).json({ error: env.nodeEnv === "production" ? "Internal server error" : (error.message || "Internal server error") });
  }
  return res.status(500).send(env.nodeEnv === "production" ? "Internal server error" : `<pre>${String(error.stack || error)}</pre>`);
});

module.exports = { app, sessionMiddleware };
