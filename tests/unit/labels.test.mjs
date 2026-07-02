import { describe, it, expect } from "vitest";
import labels from "../../src/utils/labels.js";

const { levelLabel, topicLabel, lengthLabel } = labels;

describe("levelLabel", () => {
  it("map đúng 3 cấp độ chuẩn", () => {
    expect(levelLabel("beginner")).toBe("Sơ cấp");
    expect(levelLabel("intermediate")).toBe("Trung cấp");
    expect(levelLabel("advanced")).toBe("Cao cấp");
  });
  it("không phân biệt hoa thường", () => {
    expect(levelLabel("Beginner")).toBe("Sơ cấp");
  });
  it("giá trị lạ → fallback replace('_',' ')|title như template cũ", () => {
    expect(levelLabel("upper_intermediate")).toBe("Upper Intermediate");
    expect(levelLabel("custom")).toBe("Custom");
  });
  it("rỗng/undefined/null → '—'", () => {
    expect(levelLabel("")).toBe("—");
    expect(levelLabel(undefined)).toBe("—");
    expect(levelLabel(null)).toBe("—");
  });
});

describe("topicLabel", () => {
  it("map đủ 8 chủ đề chuẩn", () => {
    expect(topicLabel("daily_life")).toBe("Đời sống hàng ngày");
    expect(topicLabel("school")).toBe("Trường học");
    expect(topicLabel("work")).toBe("Công việc");
    expect(topicLabel("travel")).toBe("Du lịch");
    expect(topicLabel("shopping")).toBe("Mua sắm");
    expect(topicLabel("food")).toBe("Ẩm thực");
    expect(topicLabel("weather")).toBe("Thời tiết");
    expect(topicLabel("culture")).toBe("Văn hóa");
  });
  it("chủ đề tự nhập (datalist tiếng Việt) → pass-through qua title", () => {
    // Hành vi cũ của template: |replace('_',' ')|title — giữ nguyên tương thích.
    expect(topicLabel("Đời sống hàng ngày")).toBe("Đời Sống Hàng Ngày".normalize());
  });
  it("rỗng → '—'", () => {
    expect(topicLabel("")).toBe("—");
  });
});

describe("lengthLabel", () => {
  it("map short/medium", () => {
    expect(lengthLabel("short")).toBe("Ngắn");
    expect(lengthLabel("medium")).toBe("Vừa");
  });
  it("giá trị lạ → |title như template cũ (không replace gạch dưới)", () => {
    expect(lengthLabel("long")).toBe("Long");
    expect(lengthLabel("extra_long")).toBe("Extra_long");
  });
  it("undefined → '—'", () => {
    expect(lengthLabel(undefined)).toBe("—");
  });
});
