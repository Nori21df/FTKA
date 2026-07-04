// So khớp câu nói với câu gốc (thuần, unit-test được).
// Chuẩn hoá: bỏ khoảng trắng + dấu câu (nhận dạng giọng nói thường không trả dấu câu).
export function normalizeKorean(text) {
    return String(text || '')
        .replace(/[\s.,!?…"'“”‘’()\-~:;]+/g, '')
        .toLowerCase();
}

// Khoảng cách Levenshtein (theo ký tự — với Hangul mỗi âm tiết là một ký tự).
export function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const curr = [i];
        for (let j = 1; j <= b.length; j++) {
            curr[j] = Math.min(
                prev[j] + 1,
                curr[j - 1] + 1,
                prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
        }
        prev = curr;
    }
    return prev[b.length];
}

// Điểm giống nhau 0–100 sau khi chuẩn hoá.
export function similarityScore(target, spoken) {
    const a = normalizeKorean(target);
    const b = normalizeKorean(spoken);
    if (!a.length && !b.length) return 100;
    if (!a.length || !b.length) return 0;
    const dist = levenshtein(a, b);
    return Math.max(0, Math.round((1 - dist / Math.max(a.length, b.length)) * 100));
}
