import { describe, it, expect } from "vitest";
import srs from "../../src/utils/srs.js";

const NOW = new Date("2026-07-04T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("srs.review — good", () => {
  it("lần đầu: interval 1 ngày, reps 1", () => {
    const r = srs.review({}, "good", NOW);
    expect(r.reps).toBe(1);
    expect(r.interval_days).toBe(1);
    expect(r.ease).toBe(2.5);
    expect(r.due.getTime()).toBe(NOW.getTime() + 1 * DAY);
  });
  it("lần hai: 3 ngày", () => {
    const r1 = srs.review({}, "good", NOW);
    const r2 = srs.review(r1, "good", NOW);
    expect(r2.reps).toBe(2);
    expect(r2.interval_days).toBe(3);
  });
  it("lần ba trở đi: interval * ease (3 → 8 với ease 2.5)", () => {
    let s = srs.review({}, "good", NOW);
    s = srs.review(s, "good", NOW);
    s = srs.review(s, "good", NOW);
    expect(s.reps).toBe(3);
    expect(s.interval_days).toBe(Math.round(3 * 2.5));
  });
});

describe("srs.review — again", () => {
  it("reset reps + interval, ease giảm 0.2, hẹn lại 10 phút", () => {
    let s = srs.review({}, "good", NOW);
    s = srs.review(s, "good", NOW);
    const r = srs.review(s, "again", NOW);
    expect(r.reps).toBe(0);
    expect(r.interval_days).toBe(0);
    expect(r.ease).toBe(2.3);
    expect(r.due.getTime()).toBe(NOW.getTime() + 10 * 60 * 1000);
  });
  it("ease không tụt dưới sàn 1.3", () => {
    let s = { reps: 5, interval_days: 30, ease: 1.35 };
    const r = srs.review(s, "again", NOW);
    expect(r.ease).toBe(1.3);
  });
});

describe("srs.review — dữ liệu bẩn", () => {
  it("state lạ/null → coi như từ mới", () => {
    const r = srs.review({ reps: -3, interval_days: "x", ease: 0 }, "good", NOW);
    expect(r.reps).toBe(1);
    expect(r.interval_days).toBe(1);
    expect(r.ease).toBe(2.5);
  });
});

describe("srs.isDue", () => {
  it("due null (chưa ôn) → đến hạn", () => {
    expect(srs.isDue(null, NOW)).toBe(true);
  });
  it("quá hạn → true; còn hạn → false", () => {
    expect(srs.isDue(new Date(NOW.getTime() - 1000), NOW)).toBe(true);
    expect(srs.isDue(new Date(NOW.getTime() + 1000), NOW)).toBe(false);
  });
});
