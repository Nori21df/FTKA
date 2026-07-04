// SRS "SM-2 lite" cho ôn ngắt quãng từ vựng (Phase tính năng — xem CLAUDE.md).
// 2 grade tối giản khớp UI hiện có: "good" (nhớ được) và "again" (chưa nhớ / ôn lại).
//
// Trạng thái mỗi từ: { reps, interval_days, ease } (mặc định 0 / 0 / 2.5).
// - good : reps+1; interval 0→1 ngày →3 ngày → interval*ease (làm tròn), ease giữ nguyên.
// - again: reps=0, interval=0, ease giảm 0.2 (sàn 1.3), hẹn lại sau 10 phút.

const DEFAULT_EASE = 2.5;
const MIN_EASE = 1.3;
const AGAIN_DELAY_MINUTES = 10;

function normalizeState(state = {}) {
  const reps = Number.isInteger(state.reps) && state.reps > 0 ? state.reps : 0;
  const interval = Number.isFinite(Number(state.interval_days)) && Number(state.interval_days) > 0
    ? Number(state.interval_days) : 0;
  const ease = Number.isFinite(Number(state.ease)) && Number(state.ease) >= MIN_EASE
    ? Number(state.ease) : DEFAULT_EASE;
  return { reps, interval_days: interval, ease };
}

// review(state, grade, now?) → { reps, interval_days, ease, due: Date }
function review(state, grade, now = new Date()) {
  const s = normalizeState(state);
  if (grade === "again") {
    const ease = Math.max(MIN_EASE, s.ease - 0.2);
    return {
      reps: 0,
      interval_days: 0,
      ease,
      due: new Date(now.getTime() + AGAIN_DELAY_MINUTES * 60 * 1000)
    };
  }
  // grade === "good" (mặc định)
  const reps = s.reps + 1;
  let interval;
  if (reps === 1) interval = 1;
  else if (reps === 2) interval = 3;
  else interval = Math.round(s.interval_days * s.ease) || 3;
  return {
    reps,
    interval_days: interval,
    ease: s.ease,
    due: new Date(now.getTime() + interval * 24 * 60 * 60 * 1000)
  };
}

// Từ "đến hạn ôn" = chưa từng ôn (due null) hoặc đã quá hạn.
function isDue(due, now = new Date()) {
  if (!due) return true;
  return new Date(due).getTime() <= now.getTime();
}

module.exports = { review, isDue, normalizeState, DEFAULT_EASE, MIN_EASE, AGAIN_DELAY_MINUTES };
