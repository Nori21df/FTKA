export function FlashcardFront(card, flipped = false) {
  return `
    <section class="anki-card-face anki-card-front" aria-hidden="${flipped}">
      <div class="anki-face-header">
        <span class="anki-card-label">Korean</span>
        <span class="anki-card-chip">Space để lật</span>
      </div>
      <div class="anki-front-content">
        <h3 lang="ko" class="anki-card-word">${escapeHtml(card.korean)}</h3>
        ${card.tts_text ? `<p class="anki-card-pronunciation">${escapeHtml(card.tts_text)}</p>` : ''}
      </div>
      <div class="anki-face-footer"><span class="material-icons-outlined" aria-hidden="true">sync</span>Lật thẻ để xem nghĩa, giải thích và ví dụ</div>
    </section>`;
}

export function FlashcardBack(card, flipped = false) {
  return `
    <section class="anki-card-face anki-card-back" aria-hidden="${!flipped}">
      <div class="anki-face-header">
        <span class="anki-card-label">Vietnamese</span>
        <span class="anki-card-chip">Đánh giá sau khi xem</span>
      </div>
      <div class="anki-back-content">
        <p class="anki-answer-label">Nghĩa</p>
        <h3 class="anki-card-meaning">${escapeHtml(card.meaning_vi || 'Chưa có nghĩa')}</h3>
        ${card.explanation_vi ? `<p class="anki-card-explain">${escapeHtml(card.explanation_vi)}</p>` : ''}
      </div>
      ${(card.example_kr || card.example_vi) ? `
        <div class="anki-example-box">
          ${card.example_kr ? `<p lang="ko" class="anki-example-kr">${escapeHtml(card.example_kr)}</p>` : ''}
          ${card.example_vi ? `<p class="anki-example-vi">${escapeHtml(card.example_vi)}</p>` : ''}
        </div>` : '<div class="anki-example-box is-empty">Chưa có ví dụ.</div>'}
    </section>`;
}

export function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
