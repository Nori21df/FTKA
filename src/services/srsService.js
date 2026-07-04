const db = require("../db");
const srs = require("../utils/srs");

// SRS cho bảng vocab: 4 cột thêm bằng ALTER (bảng có sẵn từ trước).
async function ensureSrsSchema(clientDb = db) {
  await clientDb.run("ALTER TABLE vocab ADD COLUMN IF NOT EXISTS srs_due TIMESTAMPTZ");
  await clientDb.run("ALTER TABLE vocab ADD COLUMN IF NOT EXISTS srs_interval REAL NOT NULL DEFAULT 0");
  await clientDb.run("ALTER TABLE vocab ADD COLUMN IF NOT EXISTS srs_ease REAL NOT NULL DEFAULT 2.5");
  await clientDb.run("ALTER TABLE vocab ADD COLUMN IF NOT EXISTS srs_reps INTEGER NOT NULL DEFAULT 0");
  await clientDb.run("CREATE INDEX IF NOT EXISTS idx_vocab_srs_due ON vocab(owner_user_id, srs_due)");
}

// Chấm 1 lượt ôn cho từ (grade: 'good' | 'again'), có kiểm tra chủ sở hữu.
// Trả về trạng thái SRS mới hoặc null nếu từ không tồn tại/không thuộc user.
async function reviewWord(userId, vocabId, grade) {
  const row = await db.one(
    "SELECT id, srs_interval, srs_ease, srs_reps FROM vocab WHERE id=? AND owner_user_id=?",
    [vocabId, userId]
  );
  if (!row) return null;
  const next = srs.review(
    { reps: row.srs_reps, interval_days: row.srs_interval, ease: row.srs_ease },
    grade === "again" ? "again" : "good"
  );
  await db.run(
    "UPDATE vocab SET srs_due=?, srs_interval=?, srs_ease=?, srs_reps=? WHERE id=? AND owner_user_id=?",
    [next.due.toISOString(), next.interval_days, next.ease, next.reps, vocabId, userId]
  );
  return next;
}

module.exports = { ensureSrsSchema, reviewWord };
