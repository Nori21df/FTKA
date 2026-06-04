const path = require("path");
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
const authService = require("./services/authService");

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

app.set("view engine", "html");
app.set("views", viewsDir);
app.disable("x-powered-by");
app.set("trust proxy", 1);

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

const sessionMiddleware = session({
  proxy: env.nodeEnv === "production",
  name: "ftka.sid",
  secret: env.sessionSecret || "dev-only-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: env.nodeEnv === "production"
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
    authService.loginSession(req, req.user);
  }
  next();
});
app.use(loadCurrentUser);
app.use(flash);
app.use(viewContext);

app.use((req, res, next) => {
  const redirect = res.redirect.bind(res);
  res.redirect = (statusOrUrl, maybeUrl) => {
    const status = typeof statusOrUrl === "number" ? statusOrUrl : 302;
    const target = typeof statusOrUrl === "number" ? maybeUrl : statusOrUrl;
    if (status === 302) {
      console.warn(`[redirect:302] ${req.method} ${req.originalUrl} -> ${target}`);
    }
    return typeof statusOrUrl === "number" ? redirect(statusOrUrl, maybeUrl) : redirect(statusOrUrl);
  };
  next();
});

app.use("/", webhookRoutes);
app.use("/", paymentRoutes);
app.use("/api", apiRoutes);
app.use("/admin", adminRoutes);
app.use("/", webRoutes);

app.use((req, res) => {
  res.status(404).send("Not found");
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  if (req.accepts("json") && req.path.startsWith("/api/")) {
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
  return res.status(500).send(env.nodeEnv === "production" ? "Internal server error" : `<pre>${String(error.stack || error)}</pre>`);
});

module.exports = { app, sessionMiddleware };
