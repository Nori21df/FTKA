const db = require("../db");
const { isPremiumUser } = require("../middleware/requirePremium");

const FREE = { max: 50, refillMinutes: 30, dailyBonus: 10 };
const PREMIUM = { max: 600, refillMinutes: 10, dailyBonus: 50 };

function now() { return new Date(); }
function iso(date = now()) { return date.toISOString(); }
function planFor(user) { return isPremiumUser(user) ? "premium" : "free"; }
function rulesForPlan(plan) { return plan === "premium" ? PREMIUM : FREE; }

async function getUser(userId, clientDb = db) {
  return clientDb.one("SELECT id, plan, premium_until FROM users WHERE id=?", [userId]);
}

async function ensureEnergySchema(clientDb = db) {
  await clientDb.run(`
    CREATE TABLE IF NOT EXISTS user_energy (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      current_energy INTEGER NOT NULL DEFAULT 50 CHECK (current_energy >= 0),
      max_energy INTEGER NOT NULL DEFAULT 50 CHECK (max_energy > 0),
      last_refill_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_daily_claim_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await clientDb.run(`
    CREATE TABLE IF NOT EXISTS energy_transactions (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await clientDb.run("CREATE INDEX IF NOT EXISTS idx_energy_tx_user_created ON energy_transactions(user_id, created_at DESC)");
}

async function getOrCreateEnergy(userId, clientDb = db) {
  const user = await getUser(userId, clientDb);
  if (!user) throw new Error("User not found.");
  const rules = rulesForPlan(planFor(user));
  let row = await clientDb.one("SELECT * FROM user_energy WHERE user_id=?", [userId]);
  if (!row) {
    await clientDb.run(
      "INSERT INTO user_energy (user_id, current_energy, max_energy, last_refill_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [userId, rules.max, rules.max, iso(), iso()]
    );
    row = await clientDb.one("SELECT * FROM user_energy WHERE user_id=?", [userId]);
  } else if (Number(row.max_energy) !== rules.max) {
    const current = Math.min(Number(row.current_energy || 0), rules.max);
    await clientDb.run("UPDATE user_energy SET current_energy=?, max_energy=?, updated_at=? WHERE user_id=?", [current, rules.max, iso(), userId]);
    row = { ...row, current_energy: current, max_energy: rules.max };
  }
  return row;
}

async function refillEnergy(userId, clientDb = db) {
  const user = await getUser(userId, clientDb);
  const plan = planFor(user);
  const rules = rulesForPlan(plan);
  let row = await getOrCreateEnergy(userId, clientDb);
  const current = Number(row.current_energy || 0);
  const last = new Date(row.last_refill_at || row.created_at || Date.now());
  const elapsed = Math.max(0, now().getTime() - last.getTime());
  const units = Math.floor(elapsed / (rules.refillMinutes * 60 * 1000));
  if (units <= 0 || current >= rules.max) return { ...row, plan, refill_amount: 0, refill_minutes: rules.refillMinutes, daily_bonus: rules.dailyBonus };
  const amount = Math.min(units, rules.max - current);
  const nextLast = new Date(last.getTime() + units * rules.refillMinutes * 60 * 1000);
  const balance = current + amount;
  await clientDb.run("UPDATE user_energy SET current_energy=?, max_energy=?, last_refill_at=?, updated_at=? WHERE user_id=?", [balance, rules.max, iso(nextLast), iso(), userId]);
  await clientDb.run("INSERT INTO energy_transactions (user_id, amount, balance_after, reason, ref) VALUES (?, ?, ?, ?, ?)", [userId, amount, balance, "refill", "auto"]);
  row = await clientDb.one("SELECT * FROM user_energy WHERE user_id=?", [userId]);
  return { ...row, plan, refill_amount: amount, refill_minutes: rules.refillMinutes, daily_bonus: rules.dailyBonus };
}

async function getEnergyStatus(userId) {
  const row = await refillEnergy(userId);
  return { current_energy: Number(row.current_energy), max_energy: Number(row.max_energy), last_refill_at: row.last_refill_at, last_daily_claim_at: row.last_daily_claim_at, plan: row.plan, refill_minutes: row.refill_minutes, daily_bonus: row.daily_bonus };
}

async function spendEnergy(userId, amount, reason, ref = "") {
  amount = Math.max(0, Math.floor(Number(amount || 0)));
  return db.withClient(async (clientDb) => {
    await clientDb.begin();
    try {
      await refillEnergy(userId, clientDb);
      const row = await clientDb.one("SELECT * FROM user_energy WHERE user_id=? FOR UPDATE", [userId]);
      if (Number(row.current_energy) < amount) { await clientDb.rollback(); return { ok: false, status: await getEnergyStatus(userId) }; }
      const balance = Number(row.current_energy) - amount;
      await clientDb.run("UPDATE user_energy SET current_energy=?, updated_at=? WHERE user_id=?", [balance, iso(), userId]);
      await clientDb.run("INSERT INTO energy_transactions (user_id, amount, balance_after, reason, ref) VALUES (?, ?, ?, ?, ?)", [userId, -amount, balance, reason, ref]);
      await clientDb.commit();
      return { ok: true, status: await getEnergyStatus(userId) };
    } catch (e) { await clientDb.rollback(); throw e; }
  });
}

async function grantEnergy(userId, amount, reason, ref = "") {
  amount = Math.max(0, Math.floor(Number(amount || 0)));
  return db.withClient(async (clientDb) => {
    await clientDb.begin();
    try {
      const row = await refillEnergy(userId, clientDb);
      const balance = Math.min(Number(row.current_energy) + amount, Number(row.max_energy));
      await clientDb.run("UPDATE user_energy SET current_energy=?, updated_at=? WHERE user_id=?", [balance, iso(), userId]);
      await clientDb.run("INSERT INTO energy_transactions (user_id, amount, balance_after, reason, ref) VALUES (?, ?, ?, ?, ?)", [userId, amount, balance, reason, ref]);
      await clientDb.commit();
      return { ok: true, status: await getEnergyStatus(userId) };
    } catch (e) { await clientDb.rollback(); throw e; }
  });
}

async function claimDailyEnergy(userId) {
  const status = await getEnergyStatus(userId);
  const row = await db.one("SELECT last_daily_claim_at FROM user_energy WHERE user_id=?", [userId]);
  const last = row && row.last_daily_claim_at ? new Date(row.last_daily_claim_at) : null;
  const today = iso().slice(0, 10);
  if (last && last.toISOString().slice(0, 10) === today) return { ok: false, already_claimed: true, status };
  const result = await grantEnergy(userId, status.daily_bonus, "daily_bonus", today);
  await db.run("UPDATE user_energy SET last_daily_claim_at=?, updated_at=? WHERE user_id=?", [iso(), iso(), userId]);
  return { ok: true, status: result.status };
}

module.exports = { ensureEnergySchema, getOrCreateEnergy, refillEnergy, getEnergyStatus, spendEnergy, grantEnergy, claimDailyEnergy };