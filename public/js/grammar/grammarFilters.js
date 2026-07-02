// Logic lọc thuần của trang Ngữ pháp (/grammar) — tách từ inline script views/grammar.html
// (refactor Phase 3). Không đụng DOM để unit-test được; binding ở grammarPage.js.

// Một thẻ khớp bộ lọc khi: đúng cấp độ (hoặc đang chọn 'all') VÀ khớp từ khóa
// (searchText đã lowercase sẵn từ data-search của template; query do caller lowercase).
export function cardMatches(level, searchText, currentLevel, query) {
    const matchesLevel = currentLevel === 'all' || level === currentLevel;
    const matchesQuery = !query || String(searchText || '').includes(query);
    return matchesLevel && matchesQuery;
}

// Có hiện hộp "không khớp bộ lọc" không: CÓ dữ liệu nhưng lọc ra rỗng.
// (Chưa có thẻ nào thì lưới đã có empty-state "Chưa có ngữ pháp" — không hiện chồng hộp thứ hai.)
export function shouldShowFilteredEmpty(totalCards, visibleCount) {
    return totalCards > 0 && visibleCount === 0;
}
