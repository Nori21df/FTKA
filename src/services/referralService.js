const db = require("../db");
const energy = require("./energyService");

/**
 * referralService — Mời bạn bè: cả hai +30 Sun khi người được mời XÁC MINH EMAIL.
 *
 * Luồng: link mời /register?ref=<userId> → GET /register đặt cookie ftka_ref (30 ngày)
 * → đăng ký (email hoặc Google) tạo hàng `referrals` trạng thái chờ → khi người được mời
 * verify email (Google = verify ngay khi tạo) → thưởng cả hai + đóng dấu rewarded_at.
 * Chống lạm dụng: mỗi người chỉ được "được mời" 1 lần (PK referred_user_id); chỉ ghi nhận
 * trong 15 phút đầu sau khi tạo tài khoản; mỗi người mời tối đa 20 lượt thưởng/ngày.
 */

const REWARD_AMOUNT = 30;
const DAILY_REWARD_CAP = 20; // số lượt thưởng tối đa/ngày cho MỘT người mời
const COOKIE = "ftka_ref";

async function ensureReferralSchema(clientDb = db) {
  await clientDb.run(`
    CREATE TABLE IF NOT EXISTS referrals (
      referred_user_id INTEGER PRIMARY KEY,
      referrer_user_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      rewarded_at TIMESTAMPTZ
    )`);
  await clientDb.run("CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id, rewarded_at)");
}

function readRefCookie(req) {
  const m = /(?:^|;\s*)ftka_ref=([^;]+)/.exec(req.headers.cookie || "");
  if (!m) return null;
  const id = Number.parseInt(decodeURIComponent(m[1]), 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function setRefCookie(res, referrerId) {
  res.cookie(COOKIE, String(referrerId), { maxAge: 30 * 24 * 3600 * 1000, httpOnly: true, sameSite: "lax", path: "/" });
}

// Ghi nhận "được mời" cho user mới từ cookie. An toàn gọi nhiều lần / với user cũ:
// bỏ qua nếu tự mời mình, đã có hàng, người mời không tồn tại, hoặc tài khoản đã tạo >15 phút.
async function recordPendingFromCookie(req, userId) {
  const referrerId = readRefCookie(req);
  if (!referrerId || referrerId === Number(userId)) return false;
  // Tuổi tài khoản tính TRONG SQL: users.created_at lưu chuỗi ISO-UTC nhưng cột naive —
  // đọc về JS bị hiểu theo giờ máy (lệch 7-9h). So sánh naive-UTC với naive-UTC thì chuẩn.
  const user = await db.one(
    "SELECT id, EXTRACT(EPOCH FROM ((NOW() AT TIME ZONE 'UTC') - created_at::timestamp)) AS age_sec FROM users WHERE id=?",
    [userId]
  );
  if (!user) return false;
  if (Number(user.age_sec) > 15 * 60) return false;
  const referrer = await db.one("SELECT id FROM users WHERE id=?", [referrerId]);
  if (!referrer) return false;
  const result = await db.run(
    "INSERT INTO referrals (referred_user_id, referrer_user_id) VALUES (?, ?) ON CONFLICT (referred_user_id) DO NOTHING",
    [userId, referrerId]
  );
  return result.rowCount > 0;
}

// Thưởng khi người được mời đã verify. Idempotent (điều kiện rewarded_at IS NULL + rowCount).
async function rewardIfPending(referredUserId) {
  const row = await db.one(
    "SELECT referred_user_id, referrer_user_id FROM referrals WHERE referred_user_id=? AND rewarded_at IS NULL",
    [referredUserId]
  );
  if (!row) return null;
  // trần ngày của người mời
  const todayCount = Number(await db.scalar(
    "SELECT COUNT(*) FROM referrals WHERE referrer_user_id=? AND rewarded_at >= date_trunc('day', NOW())",
    [row.referrer_user_id]
  ).catch(() => 0));
  if (todayCount >= DAILY_REWARD_CAP) return null;
  const marked = await db.run(
    "UPDATE referrals SET rewarded_at=NOW() WHERE referred_user_id=? AND rewarded_at IS NULL",
    [referredUserId]
  );
  if (!marked.rowCount) return null; // luồng khác vừa thưởng rồi
  await energy.grantEnergy(row.referrer_user_id, REWARD_AMOUNT, "referral", `moi-${referredUserId}`);
  await energy.grantEnergy(referredUserId, REWARD_AMOUNT, "referral", `duoc-moi-${row.referrer_user_id}`);
  return { referrer_user_id: row.referrer_user_id, amount: REWARD_AMOUNT };
}

// Thống kê cho widget: số bạn đã mời thành công.
async function referralStats(userId) {
  const rewarded = Number(await db.scalar(
    "SELECT COUNT(*) FROM referrals WHERE referrer_user_id=? AND rewarded_at IS NOT NULL", [userId]
  ).catch(() => 0));
  return { rewarded, reward_amount: REWARD_AMOUNT };
}

module.exports = { ensureReferralSchema, setRefCookie, recordPendingFromCookie, rewardIfPending, referralStats, REWARD_AMOUNT };
