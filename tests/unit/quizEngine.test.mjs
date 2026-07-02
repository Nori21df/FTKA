import { describe, it, expect } from "vitest";
import {
  normalizeText,
  escapeHtml,
  formatText,
  shuffle,
  buildCards,
  buildOptions,
  buildTurn,
  requeueSpacing
} from "../../public/js/quiz/quizEngine.js";

function makeCards(n) {
  return buildCards(
    Array.from({ length: n }, (_, i) => ({
      id: `w${i}`,
      korean: `한국어${i}`,
      meaning_vi: `nghĩa ${i}`,
      explanation_vi: "",
      example_kr: "",
      example_vi: "",
      tts_text: ""
    }))
  );
}

describe("normalizeText", () => {
  it("trim + fallback", () => {
    expect(normalizeText("  a  ")).toBe("a");
    expect(normalizeText("", "fb")).toBe("fb");
    expect(normalizeText(null, "fb")).toBe("fb");
    expect(normalizeText(123, "fb")).toBe("fb");
  });
});

describe("escapeHtml / formatText", () => {
  it("escape đủ 5 ký tự nguy hiểm", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
  it("formatText đổi newline thành <br>", () => {
    expect(formatText("a\nb")).toBe("a<br>b");
  });
});

describe("shuffle", () => {
  it("giữ nguyên multiset phần tử, không mutate input", () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffle(input);
    expect(out).toHaveLength(5);
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("buildCards", () => {
  it("fallback đúng như bản inline (Untitled word / No meaning saved yet)", () => {
    const [card] = buildCards([{ id: "x" }]);
    expect(card.korean).toBe("Untitled word");
    expect(card.meaning).toBe("No meaning saved yet");
    expect(card.status).toBe("active");
    expect(card.attempts).toBe(0);
  });
  it("key duy nhất theo id-index", () => {
    const cards = buildCards([{ id: "a", korean: "가" }, { id: "a", korean: "나" }]);
    expect(cards[0].key).not.toBe(cards[1].key);
  });
});

describe("buildOptions", () => {
  it("đủ 4 lựa chọn với deck lớn, có đúng 1 đáp án đúng, nhãn không trùng", () => {
    const cards = makeCards(6);
    const options = buildOptions(cards[0], "meaning", cards, []);
    expect(options).toHaveLength(4);
    expect(options.filter((o) => o.correct)).toHaveLength(1);
    expect(new Set(options.map((o) => o.label)).size).toBe(4);
    expect(options.find((o) => o.correct).label).toBe(cards[0].meaning);
  });
  it("bổ sung distractor nghĩa từ exampleViPool khi thiếu", () => {
    const cards = makeCards(2);
    const options = buildOptions(cards[0], "meaning", cards, ["câu A", "câu B", "câu C"]);
    expect(options).toHaveLength(4);
  });
  it("KHÔNG dùng pool cho chiều korean", () => {
    const cards = makeCards(2);
    const options = buildOptions(cards[0], "korean", cards, ["câu A", "câu B", "câu C"]);
    expect(options).toHaveLength(2); // chỉ 1 distractor từ thẻ còn lại
  });
  it("deck 1 thẻ → [] (kích hoạt self-check)", () => {
    const cards = makeCards(1);
    expect(buildOptions(cards[0], "korean", cards, [])).toEqual([]);
  });
  it("bỏ qua thẻ không còn active", () => {
    const cards = makeCards(3);
    cards[1].status = "done";
    cards[2].status = "mastered";
    expect(buildOptions(cards[0], "korean", cards, [])).toEqual([]);
  });
});

describe("buildTurn", () => {
  it("deck 1 thẻ, lượt đầu → self_check chiều nghĩa→Hàn", () => {
    const cards = makeCards(1);
    cards[0].attempts = 1; // nextTurn tăng attempts trước khi buildTurn
    const turn = buildTurn(cards[0], cards, []);
    expect(turn.kind).toBe("self_check");
    expect(turn.directionLabel).toBe("Nghĩa sang tiếng Hàn");
    expect(turn.audioAvailable).toBe(false);
  });
  it("deck lớn, attempts lẻ → mcq Hàn→nghĩa có audio", () => {
    const cards = makeCards(5);
    cards[0].attempts = 1;
    const turn = buildTurn(cards[0], cards, []);
    expect(turn.kind).toBe("mcq");
    expect(turn.directionLabel).toBe("Tiếng Hàn sang nghĩa");
    expect(turn.audioAvailable).toBe(true);
    expect(turn.options.length).toBeGreaterThan(1);
  });
  it("deck lớn, attempts chẵn → chiều nghĩa→Hàn, audio khoá", () => {
    const cards = makeCards(5);
    cards[0].attempts = 2;
    const turn = buildTurn(cards[0], cards, []);
    expect(turn.directionLabel).toBe("Nghĩa sang tiếng Hàn");
    expect(turn.audioAvailable).toBe(false);
  });
});

describe("requeueSpacing", () => {
  it("trả lời sai → chèn lại sớm (2)", () => {
    expect(requeueSpacing(false, 10)).toBe(2);
  });
  it("đúng/tự xem → giãn tối đa 4, giới hạn bởi độ dài hàng đợi", () => {
    expect(requeueSpacing(true, 10)).toBe(4);
    expect(requeueSpacing(null, 3)).toBe(3);
  });
});
