const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("../db");
const env = require("../config/env");
const { currentTimestamp } = require("../utils/time");
const emailService = require("./emailService");

const ACTIVE_STATUS = "active";
const ADMIN_ROLE = "admin";
const USER_ROLE = "user";
const LOCAL_PROVIDER = "local";
const GOOGLE_PROVIDER = "google";
const MIN_PASSWORD_LENGTH = 10;
const VERIFICATION_TOKEN_MINUTES = 30;
const RESET_TOKEN_MINUTES = 30;
const FORGOT_PASSWORD_MESSAGE = "Nếu email tồn tại, chúng tôi đã gửi link đặt lại mật khẩu.";

async function ensureAuthSchema(clientDb = db) {
  await clientDb.run("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ");
  await clientDb.run("ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'local'");
  await clientDb.run(`
    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await clientDb.run("CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user ON email_verification_tokens(user_id, created_at DESC)");
  await clientDb.run(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await clientDb.run("CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id, created_at DESC)");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeUsername(username) {
  return String(username || "").trim().replace(/[^A-Za-z0-9_.-]+/g, "").slice(0, 80);
}

function isValidEmail(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizeEmail(email));
}

function validatePassword(password) {
  if (!password || String(password).length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`);
  }
}

function isActiveUser(user) {
  return Boolean(user) && String(user.status || "").toLowerCase() === ACTIVE_STATUS;
}

function isAdmin(user) {
  return Boolean(user) && isActiveUser(user) && String(user.role || "").toLowerCase() === ADMIN_ROLE;
}

function isLocalUser(user) {
  return String(user?.auth_provider || LOCAL_PROVIDER).toLowerCase() === LOCAL_PROVIDER;
}

function isEmailVerified(user) {
  if (!user || !isLocalUser(user)) return true;
  return Boolean(user.email_verified_at || user.email_verified);
}

function safeSessionId(req) {
  return req?.sessionID ? `${String(req.sessionID).slice(0, 8)}...` : "none";
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) return resolve();
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function destroySession(req) {
  return new Promise((resolve) => {
    if (!req.session) return resolve();
    req.session.destroy((error) => {
      if (error) console.error("[auth] Session destroy failed:", error);
      resolve();
    });
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    if (!req.session) return resolve();
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function verificationUrl(rawToken) {
  const baseUrl = String(env.appUrl || env.baseUrl || "http://localhost:3000").replace(/\/+$/, "");
  return `${baseUrl}/verify-email?token=${encodeURIComponent(rawToken)}`;
}

function passwordResetUrl(rawToken) {
  const baseUrl = String(env.appUrl || env.baseUrl || "http://localhost:3000").replace(/\/+$/, "");
  return `${baseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
}

async function createVerificationToken(userId, clientDb = db) {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const hash = tokenHash(rawToken);
  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_MINUTES * 60 * 1000).toISOString();
  await clientDb.run(
    "INSERT INTO email_verification_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
    [userId, hash, expiresAt, currentTimestamp()]
  );
  return { rawToken, expiresAt };
}

async function sendVerificationForUser(user) {
  const { rawToken } = await createVerificationToken(user.id);
  return emailService.sendVerificationEmail(user, verificationUrl(rawToken));
}

async function getUserById(userId) {
  const parsed = Number.parseInt(userId, 10);
  if (!Number.isInteger(parsed)) return null;
  return db.one("SELECT * FROM users WHERE id=?", [parsed]);
}

async function getUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return db.one("SELECT * FROM users WHERE LOWER(email)=LOWER(?)", [normalized]);
}

async function getUserByLogin(loginValue) {
  const login = String(loginValue || "").trim();
  if (!login) return null;
  return db.one(
    "SELECT * FROM users WHERE LOWER(username)=LOWER(?) OR LOWER(email)=LOWER(?)",
    [login, login]
  );
}

async function authenticateUser(loginValue, password) {
  const user = await getUserByLogin(loginValue);
  if (!user || !user.password_hash) return null;
  const ok = await bcrypt.compare(String(password || ""), user.password_hash);
  if (!ok || !isActiveUser(user)) return null;
  const now = currentTimestamp();
  await db.run("UPDATE users SET last_login=?, updated_at=? WHERE id=?", [now, now, user.id]);
  return getUserById(user.id);
}

async function createUser(username, email, password) {
  const cleanUsername = normalizeUsername(username);
  const cleanEmail = normalizeEmail(email);
  if (!cleanUsername) throw new Error("Vui lòng nhập tên đăng nhập.");
  if (!isValidEmail(cleanEmail)) throw new Error("Vui lòng nhập email hợp lệ.");
  validatePassword(password);

  const existing = await db.one(
    "SELECT id FROM users WHERE LOWER(username)=LOWER(?) OR LOWER(email)=LOWER(?)",
    [cleanUsername, cleanEmail]
  );
  if (existing) throw new Error("Tên đăng nhập hoặc email đã tồn tại.");

  const now = currentTimestamp();
  const passwordHash = await bcrypt.hash(password, 12);
  await db.run(
    `INSERT INTO users (
      username, email, password_hash, google_sub, avatar_url, auth_provider,
      role, status, email_verified, email_verified_at, created_at, updated_at, last_login
    ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, FALSE, NULL, ?, ?, NULL)`,
    [cleanUsername, cleanEmail, passwordHash, LOCAL_PROVIDER, USER_ROLE, ACTIVE_STATUS, now, now]
  );
  const user = await getUserByEmail(cleanEmail);
  await sendVerificationForUser(user);
  return user;
}

async function makeUniqueUsername(preferred) {
  const base = (normalizeUsername(preferred) || "user").slice(0, 72);
  let candidate = base;
  let suffix = 2;
  while (await db.one("SELECT id FROM users WHERE LOWER(username)=LOWER(?)", [candidate])) {
    candidate = `${base}${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function getOrCreateGoogleUser(profile) {
  const googleSub = String(profile.id || profile.sub || "").trim();
  const cleanEmail = normalizeEmail(profile.emails?.[0]?.value || profile.email);
  const name = String(profile.displayName || profile.name || cleanEmail.split("@")[0] || "").trim();
  const avatarUrl = String(profile.photos?.[0]?.value || profile.picture || "").trim();
  if (!googleSub) throw new Error("Google không trả về ID người dùng ổn định.");
  if (!isValidEmail(cleanEmail)) throw new Error("Google không trả về email hợp lệ.");

  const bySub = await db.one("SELECT * FROM users WHERE google_sub=?", [googleSub]);
  const now = currentTimestamp();
  if (bySub) {
    if (!isActiveUser(bySub)) throw new Error("Tài khoản này không hoạt động.");
    await db.run("UPDATE users SET avatar_url=?, auth_provider=?, email_verified=TRUE, email_verified_at=COALESCE(email_verified_at, ?), last_login=?, updated_at=? WHERE id=?", [
      avatarUrl || bySub.avatar_url,
      GOOGLE_PROVIDER,
      now,
      now,
      now,
      bySub.id
    ]);
    return getUserById(bySub.id);
  }

  const byEmail = await getUserByEmail(cleanEmail);
  if (byEmail) {
    if (!isActiveUser(byEmail)) throw new Error("Tài khoản này không hoạt động.");
    await db.run(
      `UPDATE users SET google_sub=?, avatar_url=?, auth_provider=?, email_verified=TRUE, email_verified_at=COALESCE(email_verified_at, ?),
       last_login=?, updated_at=? WHERE id=?`,
      [googleSub, avatarUrl || byEmail.avatar_url, GOOGLE_PROVIDER, now, now, now, byEmail.id]
    );
    return getUserById(byEmail.id);
  }

  const username = await makeUniqueUsername(name);
  await db.run(
    `INSERT INTO users (
      username, email, password_hash, google_sub, avatar_url, auth_provider,
      role, status, email_verified, email_verified_at, created_at, updated_at, last_login
    ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, TRUE, ?, ?, ?, ?)`,
    [username, cleanEmail, googleSub, avatarUrl, GOOGLE_PROVIDER, USER_ROLE, ACTIVE_STATUS, now, now, now, now]
  );
  return db.one("SELECT * FROM users WHERE google_sub=?", [googleSub]);
}

async function verifyEmailToken(rawToken) {
  const hash = tokenHash(rawToken);
  if (!rawToken || !hash) return { ok: false, reason: "Token xác minh không hợp lệ." };
  return db.withClient(async (clientDb) => {
    await clientDb.begin();
    try {
      const row = await clientDb.one(
        `SELECT email_verification_tokens.*, users.id AS account_id
         FROM email_verification_tokens
         JOIN users ON users.id = email_verification_tokens.user_id
         WHERE email_verification_tokens.token_hash=?
         FOR UPDATE`,
        [hash]
      );
      const now = currentTimestamp();
      if (!row || row.used_at || new Date(row.expires_at) <= new Date()) {
        await clientDb.commit();
        return { ok: false, reason: "Liên kết xác minh đã hết hạn hoặc không hợp lệ." };
      }
      await clientDb.run("UPDATE users SET email_verified=TRUE, email_verified_at=COALESCE(email_verified_at, ?), updated_at=? WHERE id=?", [now, now, row.user_id]);
      await clientDb.run("UPDATE email_verification_tokens SET used_at=? WHERE id=?", [now, row.id]);
      await clientDb.commit();
      return { ok: true };
    } catch (error) {
      await clientDb.rollback();
      throw error;
    }
  });
}

async function resendVerificationEmail(user) {
  if (!user || !isLocalUser(user) || isEmailVerified(user)) {
    const error = new Error("Không cần xác minh email cho tài khoản này.");
    error.statusCode = 400;
    throw error;
  }
  const recent = await db.one(
    `SELECT created_at FROM email_verification_tokens
     WHERE user_id=? AND used_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
    [user.id]
  );
  if (recent && Date.now() - new Date(recent.created_at).getTime() < 60 * 1000) {
    const error = new Error("Vui lòng chờ trước khi gửi lại email xác minh.");
    error.statusCode = 429;
    throw error;
  }
  await db.run("UPDATE email_verification_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL", [currentTimestamp(), user.id]);
  return sendVerificationForUser(user);
}

async function requestPasswordReset(email) {
  const cleanEmail = normalizeEmail(email);
  if (!isValidEmail(cleanEmail)) return { ok: true, message: FORGOT_PASSWORD_MESSAGE };
  const user = await getUserByEmail(cleanEmail);
  if (!user || !isActiveUser(user) || !isLocalUser(user) || !user.password_hash) {
    return { ok: true, message: FORGOT_PASSWORD_MESSAGE };
  }

  try {
    await db.run("UPDATE password_reset_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL", [currentTimestamp(), user.id]);
    const rawToken = crypto.randomBytes(32).toString("hex");
    const hash = tokenHash(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_MINUTES * 60 * 1000).toISOString();
    await db.run(
      "INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)",
      [user.id, hash, expiresAt, currentTimestamp()]
    );
    await emailService.sendPasswordResetEmail(user, passwordResetUrl(rawToken));
  } catch (error) {
    console.error(`[auth] Password reset request failed for user ${user.id}: ${error.message}`);
  }
  return { ok: true, message: FORGOT_PASSWORD_MESSAGE };
}

async function getValidPasswordResetToken(rawToken) {
  if (!rawToken) return null;
  const hash = tokenHash(rawToken);
  const row = await db.one(
    `SELECT password_reset_tokens.*, users.email
     FROM password_reset_tokens
     JOIN users ON users.id = password_reset_tokens.user_id
     WHERE password_reset_tokens.token_hash=?`,
    [hash]
  );
  if (!row || row.used_at || new Date(row.expires_at) <= new Date()) return null;
  return row;
}

async function resetPassword(rawToken, password, confirmPassword) {
  try {
    validatePassword(password);
  } catch (error) {
    return { ok: false, error: error.message };
  }
  if (String(password) !== String(confirmPassword || "")) {
    return { ok: false, error: "Mật khẩu xác nhận không khớp." };
  }

  const hash = tokenHash(rawToken);
  return db.withClient(async (clientDb) => {
    await clientDb.begin();
    try {
      const row = await clientDb.one(
        `SELECT * FROM password_reset_tokens WHERE token_hash=? FOR UPDATE`,
        [hash]
      );
      if (!rawToken || !row || row.used_at || new Date(row.expires_at) <= new Date()) {
        await clientDb.commit();
        return { ok: false, error: "Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn." };
      }
      const now = currentTimestamp();
      const passwordHash = await bcrypt.hash(password, 12);
      await clientDb.run("UPDATE users SET password_hash=?, updated_at=? WHERE id=?", [passwordHash, now, row.user_id]);
      await clientDb.run("UPDATE password_reset_tokens SET used_at=? WHERE id=?", [now, row.id]);
      await clientDb.run("UPDATE password_reset_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL", [now, row.user_id]);
      await clientDb.commit();
      return { ok: true };
    } catch (error) {
      await clientDb.rollback();
      throw error;
    }
  });
}

function setSessionUser(req, user, reason = "login") {
  req.session.user_id = user.id;
  req.session.username = user.username;
  req.session.email = user.email;
  req.session.role = user.role;
  req.session.authenticated_at = currentTimestamp();
  console.log(`[auth] Session user set (${reason})`, {
    sessionId: safeSessionId(req),
    userId: user.id,
    provider: user.auth_provider || LOCAL_PROVIDER
  });
}

async function loginSession(req, user, reason = "password") {
  const previousSessionId = safeSessionId(req);
  await regenerateSession(req);
  setSessionUser(req, user, reason);
  await saveSession(req);
  console.log("[auth] Session created", {
    previousSessionId,
    sessionId: safeSessionId(req),
    userId: user.id,
    reason
  });
}

async function logoutSession(req) {
  const sessionId = safeSessionId(req);
  const userId = req.session?.user_id;
  await destroySession(req);
  console.log("[auth] Session destroyed", { sessionId, userId });
}

module.exports = {
  ADMIN_ROLE,
  USER_ROLE,
  ACTIVE_STATUS,
  LOCAL_PROVIDER,
  GOOGLE_PROVIDER,
  FORGOT_PASSWORD_MESSAGE,
  ensureAuthSchema,
  isActiveUser,
  isAdmin,
  isLocalUser,
  isEmailVerified,
  getUserById,
  getUserByEmail,
  getUserByLogin,
  authenticateUser,
  createUser,
  verifyEmailToken,
  resendVerificationEmail,
  requestPasswordReset,
  getValidPasswordResetToken,
  resetPassword,
  getOrCreateGoogleUser,
  setSessionUser,
  loginSession,
  logoutSession
};
