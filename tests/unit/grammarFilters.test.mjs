import { describe, it, expect } from "vitest";
import { cardMatches, shouldShowFilteredEmpty } from "../../public/js/grammar/grammarFilters.js";

describe("cardMatches", () => {
  it("'all' khớp mọi cấp độ", () => {
    expect(cardMatches("topik1", "abc", "all", "")).toBe(true);
    expect(cardMatches("general", "abc", "all", "")).toBe(true);
  });
  it("lọc theo cấp độ cụ thể", () => {
    expect(cardMatches("topik1", "abc", "topik1", "")).toBe(true);
    expect(cardMatches("topik2", "abc", "topik1", "")).toBe(false);
  });
  it("query rỗng khớp tất cả; query khớp substring của data-search", () => {
    expect(cardMatches("topik1", "먹다 ăn cơm", "all", "")).toBe(true);
    expect(cardMatches("topik1", "먹다 ăn cơm", "all", "ăn")).toBe(true);
    expect(cardMatches("topik1", "먹다 ăn cơm", "all", "ngủ")).toBe(false);
  });
  it("cả hai điều kiện phải cùng đúng", () => {
    expect(cardMatches("topik2", "abc", "topik1", "abc")).toBe(false);
    expect(cardMatches("topik1", "abc", "topik1", "xyz")).toBe(false);
  });
  it("searchText null/undefined không crash", () => {
    expect(cardMatches("topik1", undefined, "all", "x")).toBe(false);
  });
});

describe("shouldShowFilteredEmpty", () => {
  it("có thẻ nhưng lọc ra rỗng → hiện", () => {
    expect(shouldShowFilteredEmpty(5, 0)).toBe(true);
  });
  it("không có thẻ nào (empty-state chính đã hiện) → ẩn", () => {
    expect(shouldShowFilteredEmpty(0, 0)).toBe(false);
  });
  it("còn thẻ hiển thị → ẩn", () => {
    expect(shouldShowFilteredEmpty(5, 2)).toBe(false);
  });
});
