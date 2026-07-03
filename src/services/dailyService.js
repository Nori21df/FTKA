const db = require("../db");

// Tab "Học hôm nay": mỗi user một đoạn tiếng Hàn + bản dịch cho mỗi ngày (lưu cache theo ngày).
// Chủ đề xoay vòng để đa dạng giữa các lần tạo lại.
const DAILY_TOPICS = [
  "đời sống hàng ngày",
  "gia đình",
  "trường học",
  "công việc",
  "sở thích và giải trí",
  "du lịch",
  "ẩm thực Hàn Quốc",
  "thời tiết và mùa",
  "mua sắm",
  "sức khỏe và thói quen",
  "tình bạn",
  "văn hóa Hàn Quốc"
];

// Ngày theo giờ Việt Nam (UTC+7) để ranh giới "hôm nay" khớp người dùng VN. Dạng YYYY-MM-DD.
function todayStr() {
  const vn = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return vn.toISOString().slice(0, 10);
}

function pickTopic() {
  return DAILY_TOPICS[Math.floor(Math.random() * DAILY_TOPICS.length)];
}

async function ensureDailySchema(clientDb = db) {
  await clientDb.run(`
    CREATE TABLE IF NOT EXISTS daily_passages (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      passage_date DATE NOT NULL,
      title TEXT,
      korean_text TEXT NOT NULL,
      vietnamese_text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, passage_date)
    )
  `);
  await clientDb.run("CREATE INDEX IF NOT EXISTS idx_daily_passages_user_date ON daily_passages(user_id, passage_date DESC)");
}

function serialize(row) {
  if (!row) return null;
  return {
    date: typeof row.passage_date === "string" ? row.passage_date : new Date(row.passage_date).toISOString().slice(0, 10),
    title: row.title || "",
    korean: row.korean_text || "",
    vietnamese: row.vietnamese_text || "",
    created_at: row.created_at
  };
}

async function getPassageForDate(userId, date) {
  const row = await db.one("SELECT * FROM daily_passages WHERE user_id=? AND passage_date=?", [userId, date]);
  return serialize(row);
}

// Upsert đoạn văn của ngày (tạo mới hoặc thay khi bấm "tạo đoạn khác").
async function savePassage(userId, date, passage) {
  await db.run(
    `INSERT INTO daily_passages (user_id, passage_date, title, korean_text, vietnamese_text)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, passage_date)
     DO UPDATE SET title = EXCLUDED.title, korean_text = EXCLUDED.korean_text,
                   vietnamese_text = EXCLUDED.vietnamese_text, created_at = NOW()`,
    [userId, date, passage.title || "", passage.korean, passage.vietnamese]
  );
  return getPassageForDate(userId, date);
}

module.exports = {
  DAILY_TOPICS,
  todayStr,
  pickTopic,
  ensureDailySchema,
  getPassageForDate,
  savePassage
};
