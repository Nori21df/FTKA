const crypto = require("crypto");
const db = require("../db");
const { isPremiumUser } = require("../middleware/requirePremium");

/**
 * premiumKeyService — bán Premium bằng KEY thủ công (không cần cổng thanh toán):
 * admin tạo key theo số ngày (30/90/365...) → bán tay (chat/CK tuỳ kênh) → người mua
 * nhập key ở trang Hồ sơ → cộng ngày Premium (nối tiếp nếu đang còn hạn, như SePay).
 * Key lưu PLAINTEXT để admin còn xem/copy đem bán; entropy 20 ký tự nên không brute-force nổi
 * (redeem có rate-limit thêm một lớp).
 */

// Bỏ ký tự dễ nhầm (I/O/0/1) — key dạng FTKA-XXXXX-XXXXX-XXXXX-XXXXX
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode() {
  const bytes = crypto.randomBytes(20);
  let s = "";
  for (let i = 0; i < 20; i += 1) {
    s += ALPHABET[bytes[i] % ALPHABET.length];
    if (i % 5 === 4 && i < 19) s += "-";
  }
  return `FTKA-${s}`;
}

async function ensurePremiumKeySchema(clientDb = db) {
  await clientDb.run(`
    CREATE TABLE IF NOT EXISTS premium_keys (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      days INTEGER NOT NULL,
      note TEXT,
      created_by INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      used_by INTEGER,
      used_at TIMESTAMPTZ
    )`);
  await clientDb.run("CREATE INDEX IF NOT EXISTS idx_premium_keys_unused ON premium_keys(used_at) WHERE used_at IS NULL");
}

async function generateKeys(adminId, days, count, note = "") {
  days = Math.max(1, Math.min(3650, Math.floor(Number(days) || 0)));
  count = Math.max(1, Math.min(100, Math.floor(Number(count) || 1)));
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    const code = makeCode();
    await db.run(
      "INSERT INTO premium_keys (code, days, note, created_by) VALUES (?, ?, ?, ?)",
      [code, days, String(note || "").slice(0, 200), adminId]
    );
    codes.push(code);
  }
  return codes;
}

async function listKeys(limit = 200) {
  return db.query(
    `SELECT k.*, u.username AS used_by_username
     FROM premium_keys k LEFT JOIN users u ON u.id = k.used_by
     ORDER BY (k.used_at IS NULL) DESC, k.id DESC LIMIT ?`,
    [Math.min(Number(limit) || 200, 500)]
  );
}

// Xoá key CHƯA dùng (key đã dùng giữ lại làm lịch sử bán hàng).
async function deleteUnusedKey(id) {
  const r = await db.run("DELETE FROM premium_keys WHERE id=? AND used_at IS NULL", [id]);
  return r.rowCount > 0;
}

function normalizeCode(raw) {
  const s = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!s) return "";
  // cho phép nhập thiếu "FTKA" đầu / thiếu dấu gạch — dựng lại dạng chuẩn
  const body = s.startsWith("FTKA") ? s.slice(4) : s;
  if (body.length !== 20) return null;
  return "FTKA-" + body.match(/.{5}/g).join("-");
}

// Nhập key: khoá hàng (FOR UPDATE) chống dùng 1 key 2 lần song song; cộng ngày nối tiếp hạn cũ.
async function redeemKey(userId, rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, error: "Key không đúng định dạng — kiểm tra lại nhé." };
  return db.withClient(async (clientDb) => {
    await clientDb.begin();
    try {
      const key = await clientDb.one("SELECT * FROM premium_keys WHERE code=? FOR UPDATE", [code]);
      if (!key) { await clientDb.commit(); return { ok: false, error: "Key không tồn tại — kiểm tra lại nhé." }; }
      if (key.used_at) { await clientDb.commit(); return { ok: false, error: "Key này đã được sử dụng." }; }
      const user = await clientDb.one("SELECT id, plan, premium_until FROM users WHERE id=? FOR UPDATE", [userId]);
      if (!user) { await clientDb.rollback(); return { ok: false, error: "Không tìm thấy tài khoản." }; }
      const base = isPremiumUser(user) ? new Date(user.premium_until) : new Date();
      const premiumUntil = new Date(base.getTime() + key.days * 24 * 3600 * 1000);
      await clientDb.run(
        "UPDATE users SET plan='premium', premium_until=?, updated_at=? WHERE id=?",
        [premiumUntil.toISOString(), new Date().toISOString(), userId]
      );
      await clientDb.run("UPDATE premium_keys SET used_by=?, used_at=NOW() WHERE id=?", [userId, key.id]);
      await clientDb.commit();
      return { ok: true, days: key.days, premium_until: premiumUntil };
    } catch (e) {
      await clientDb.rollback();
      throw e;
    }
  });
}

module.exports = { ensurePremiumKeySchema, generateKeys, listKeys, deleteUnusedKey, redeemKey, normalizeCode };
