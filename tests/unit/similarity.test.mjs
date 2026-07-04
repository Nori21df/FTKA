import { describe, it, expect } from "vitest";
import { normalizeKorean, levenshtein, similarityScore } from "../../public/js/speak/similarity.js";

describe("normalizeKorean", () => {
  it("bỏ khoảng trắng + dấu câu", () => {
    expect(normalizeKorean("안녕하세요. 만나서 반갑습니다!")).toBe("안녕하세요만나서반갑습니다");
  });
  it("rỗng/null an toàn", () => {
    expect(normalizeKorean("")).toBe("");
    expect(normalizeKorean(null)).toBe("");
  });
});

describe("levenshtein", () => {
  it("chuỗi giống nhau = 0", () => {
    expect(levenshtein("가나다", "가나다")).toBe(0);
  });
  it("đếm đúng số sửa đổi", () => {
    expect(levenshtein("가나다", "가나라")).toBe(1);
    expect(levenshtein("가나다", "")).toBe(3);
  });
});

describe("similarityScore", () => {
  it("khớp hoàn toàn (kể cả khác dấu câu/khoảng trắng) = 100", () => {
    expect(similarityScore("안녕하세요. 만나서 반갑습니다.", "안녕하세요 만나서 반갑습니다")).toBe(100);
  });
  it("khác một phần → điểm giữa", () => {
    const score = similarityScore("저는 한국어를 공부해요", "저는 한국어를 공부합니다");
    expect(score).toBeGreaterThan(50);
    expect(score).toBeLessThan(100);
  });
  it("không nói gì = 0", () => {
    expect(similarityScore("안녕하세요", "")).toBe(0);
  });
});
