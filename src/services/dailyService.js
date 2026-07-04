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
  // Câu hỏi đọc hiểu đi kèm đoạn văn (thêm sau nên dùng ALTER cho bảng đã tồn tại).
  await clientDb.run("ALTER TABLE daily_passages ADD COLUMN IF NOT EXISTS quiz_items JSONB NOT NULL DEFAULT '[]'");
  await clientDb.run("CREATE INDEX IF NOT EXISTS idx_daily_passages_user_date ON daily_passages(user_id, passage_date DESC)");
}

function normalizeDateValue(value) {
  if (typeof value === "string") return value.slice(0, 10);
  // pg trả cột DATE thành JS Date ở nửa đêm GIỜ ĐỊA PHƯƠNG → toISOString() có thể lùi 1 ngày.
  // Dùng date parts địa phương để giữ đúng ngày lịch đã lưu.
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseQuizItems(raw) {
  const items = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : raw;
  return Array.isArray(items) ? items : [];
}

function serialize(row) {
  if (!row) return null;
  return {
    date: normalizeDateValue(row.passage_date),
    title: row.title || "",
    korean: row.korean_text || "",
    vietnamese: row.vietnamese_text || "",
    quiz_items: parseQuizItems(row.quiz_items),
    created_at: row.created_at
  };
}

// Chỉ chấp nhận ngày dạng YYYY-MM-DD (chống input lạ từ query param).
function isValidDateStr(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

async function getPassageForDate(userId, date) {
  const row = await db.one("SELECT * FROM daily_passages WHERE user_id=? AND passage_date=?", [userId, date]);
  return serialize(row);
}

// Danh sách ngày đã có đoạn văn (mới nhất trước) cho dải chip lịch sử.
async function listRecentDates(userId, limit = 14) {
  const rows = await db.query(
    "SELECT passage_date FROM daily_passages WHERE user_id=? ORDER BY passage_date DESC LIMIT ?",
    [userId, limit]
  );
  return rows.map((r) => normalizeDateValue(r.passage_date));
}

// Upsert đoạn văn của ngày (tạo mới hoặc thay khi bấm "tạo đoạn khác").
async function savePassage(userId, date, passage) {
  await db.run(
    `INSERT INTO daily_passages (user_id, passage_date, title, korean_text, vietnamese_text, quiz_items)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, passage_date)
     DO UPDATE SET title = EXCLUDED.title, korean_text = EXCLUDED.korean_text,
                   vietnamese_text = EXCLUDED.vietnamese_text, quiz_items = EXCLUDED.quiz_items,
                   created_at = NOW()`,
    [userId, date, passage.title || "", passage.korean, passage.vietnamese, JSON.stringify(passage.quiz_items || [])]
  );
  return getPassageForDate(userId, date);
}

module.exports = {
  DAILY_TOPICS,
  todayStr,
  pickTopic,
  isValidDateStr,
  ensureDailySchema,
  getPassageForDate,
  listRecentDates,
  savePassage
};
