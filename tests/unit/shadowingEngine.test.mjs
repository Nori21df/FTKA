import { describe, it, expect } from "vitest";
import { ShadowingEngine } from "../../public/js/shadowing/shadowingEngine.js";

const DECK = [
  { kr: "안녕하세요", vi: "Xin chào" },
  { kr: "감사합니다", vi: "Cảm ơn" },
];

describe("ShadowingEngine — vòng và chuyển câu", () => {
  it("chấm đủ R vòng thì tự sang câu kế, hết câu thì completed", () => {
    const e = new ShadowingEngine(DECK, 2);
    expect(e.currentSentence.kr).toBe("안녕하세요");
    expect(e.recordAttempt(70).transition).toBe("round");    // vòng 1 → 2
    expect(e.round).toBe(2);
    expect(e.recordAttempt(90).transition).toBe("sentence"); // hết vòng → câu 2
    expect(e.index).toBe(1);
    expect(e.round).toBe(1);
    e.recordAttempt(50);
    const last = e.recordAttempt(60);
    expect(last.transition).toBe("done");
    expect(e.isComplete).toBe(true);
  });

  it("prev/next reset vòng về 1 và không vượt biên", () => {
    const e = new ShadowingEngine(DECK, 3);
    e.recordAttempt(10); // round 2
    e.next();
    expect(e.index).toBe(1);
    expect(e.round).toBe(1);
    e.next(); // đã ở cuối — đứng yên
    expect(e.index).toBe(1);
    e.prev();
    expect(e.index).toBe(0);
    e.prev(); // đã ở đầu — đứng yên
    expect(e.index).toBe(0);
  });
});

describe("ShadowingEngine — điểm", () => {
  it("giữ điểm TỐT NHẤT mỗi câu; averageScore trên các câu đã chấm", () => {
    const e = new ShadowingEngine(DECK, 2);
    e.recordAttempt(40);
    e.recordAttempt(80); // câu 1 best = 80, sang câu 2
    e.recordAttempt(60);
    expect(e.bestScores[0]).toBe(80);
    expect(e.bestScores[1]).toBe(60);
    expect(e.averageScore()).toBe(70);
  });

  it("chuẩn hoá điểm ngoài khoảng và input rác", () => {
    const e = new ShadowingEngine(DECK, 1);
    e.recordAttempt(150);
    expect(e.bestScores[0]).toBe(100);
    e.recordAttempt("rác");
    expect(e.bestScores[1]).toBe(0);
  });

  it("deck rỗng → completed ngay, không nổ", () => {
    const e = new ShadowingEngine([], 3);
    expect(e.isComplete).toBe(true);
    expect(e.currentSentence).toBeNull();
    expect(e.averageScore()).toBe(0);
    expect(() => e.recordAttempt(50)).not.toThrow();
  });
});
