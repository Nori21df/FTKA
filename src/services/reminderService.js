const db = require("../db");
const learning = require("./learningService");
const emailService = require("./emailService");

// Nhắc học hằng ngày qua email: user đang có chuỗi >= MIN_STREAK nhưng HÔM NAY chưa học
// → gửi 1 email nhắc (tối đa 1 lần/ngày/user, chống trùng bằng reminder_log).
// Chỉ quét user có hoạt động 3 ngày gần đây để truy vấn nhẹ; giờ gửi 19–22h VN.
const MIN_STREAK = 2;
const SEND_HOUR_FROM = 19;
const SEND_HOUR_TO = 22;
const MAX_PER_RUN = 50;
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

function vnHour() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCHours();
}

function vnToday() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function ensureReminderSchema(clientDb = db) {
  await clientDb.run(`
    CREATE TABLE IF NOT EXISTS reminder_log (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      remind_date DATE NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, remind_date)
    )
  `);
}

async function runReminderSweep() {
  const today = vnToday();
  // Ứng viên: có hoạt động học trong 3 ngày gần đây (bảng nhỏ, quét nhanh)
  const candidates = await db.query(
    `SELECT DISTINCT users.id, users.username, users.email
     FROM learning_activity
     JOIN users ON users.id = learning_activity.owner_user_id
     WHERE learning_activity.created_at::timestamptz >= NOW() - INTERVAL '3 days'
       AND users.status = 'active'
     LIMIT 200`
  );
  let sent = 0;
  for (const user of candidates) {
    if (sent >= MAX_PER_RUN) break;
    // "Sắp mất chuỗi" = hôm nay CHƯA học nhưng chuỗi tính đến hết hôm qua >= MIN_STREAK.
    // (Không dùng streak.status: 'at_risk' trong getLearningStreakStats không bao giờ
    //  xảy ra vì vòng đếm break ngay tại hôm-nay-0.)
    const timeline = await learning.getLearningActivityTimeline(user.id, 31);
    const todayCount = timeline[timeline.length - 1]?.count || 0;
    if (todayCount > 0) continue;
    let streakUntilYesterday = 0;
    for (let i = timeline.length - 2; i >= 0; i -= 1) {
      if (timeline[i].count > 0) streakUntilYesterday += 1;
      else break;
    }
    if (streakUntilYesterday < MIN_STREAK) continue;
    const inserted = await db.run(
      "INSERT INTO reminder_log (user_id, remind_date) VALUES (?, ?) ON CONFLICT (user_id, remind_date) DO NOTHING",
      [user.id, today]
    );
    if (!inserted || inserted.rowCount === 0) continue; // hôm nay đã nhắc rồi
    await emailService.sendStudyReminderEmail(user, streakUntilYesterday);
    sent += 1;
  }
  return sent;
}

// Gọi 1 lần từ server.js. Tắt bằng env STUDY_REMINDER_ENABLED=false.
function startReminderScheduler() {
  if (String(process.env.STUDY_REMINDER_ENABLED || "true").toLowerCase() === "false") {
    console.log("[reminder] Tắt theo STUDY_REMINDER_ENABLED=false");
    return null;
  }
  const timer = setInterval(async () => {
    try {
      const hour = vnHour();
      if (hour < SEND_HOUR_FROM || hour > SEND_HOUR_TO) return;
      const sent = await runReminderSweep();
      if (sent > 0) console.log(`[reminder] Đã gửi ${sent} email nhắc học.`);
    } catch (error) {
      console.error("[reminder] Sweep lỗi:", error.message);
    }
  }, CHECK_INTERVAL_MS);
  timer.unref?.(); // không giữ process sống chỉ vì scheduler
  return timer;
}

module.exports = { ensureReminderSchema, startReminderScheduler, runReminderSweep, vnToday };
