const db = require("../db");
const energy = require("./energyService");

// Mốc thưởng chuỗi ngày học: đạt mốc lần đầu → tặng năng lượng (mỗi mốc 1 lần cho mỗi user).
const MILESTONES = [
  { days: 7, amount: 20 },
  { days: 30, amount: 60 },
  { days: 100, amount: 200 }
];

async function ensureStreakRewardSchema(clientDb = db) {
  await clientDb.run(`
    CREATE TABLE IF NOT EXISTS streak_rewards (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      milestone INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, milestone)
    )
  `);
}

// Kiểm tra & phát thưởng cho các mốc user vừa đạt. Trả về danh sách mốc MỚI được phát
// (rỗng nếu không có gì mới) để dashboard hiện thông báo.
async function claimDueRewards(userId, streakDays) {
  const due = MILESTONES.filter((m) => streakDays >= m.days);
  if (!due.length) return [];
  const granted = [];
  for (const m of due) {
    // ON CONFLICT DO NOTHING + RETURNING: chỉ hàng chèn MỚI mới trả về → chống phát trùng
    // kể cả khi 2 request dashboard chạy song song.
    const result = await db.run(
      "INSERT INTO streak_rewards (user_id, milestone, amount) VALUES (?, ?, ?) ON CONFLICT (user_id, milestone) DO NOTHING",
      [userId, m.days, m.amount]
    );
    if (result && result.rowCount > 0) {
      await energy.grantEnergy(userId, m.amount, "streak_reward", `streak_${m.days}`);
      granted.push({ milestone: m.days, amount: m.amount });
    }
  }
  return granted;
}

module.exports = { MILESTONES, ensureStreakRewardSchema, claimDueRewards };
