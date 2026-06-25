import { FlashcardFront, FlashcardBack, escapeHtml } from './FlashcardSides.js';

export function Flashcard({ card, flipped, learned, difficult, stats }) {
  if (!card) {
    const allLearned = stats?.total > 0 && stats?.remaining === 0;
    const message = allLearned ? `Bạn đã học hết ${stats.total} từ.` : 'Không còn thẻ trong hàng đợi hiện tại.';
    return `
      <div class="anki-session-complete" role="status">
        <span class="material-icons-outlined" aria-hidden="true">celebration</span>
        <h3>Chúc mừng!</h3>
        <p>${escapeHtml(message)}</p>
        <div class="anki-session-complete-actions">
          <button type="button" class="primary-cta" data-action="review-learned">Ôn lại từ đã học</button>
          <button type="button" class="secondary-cta" data-action="reset-progress">Reset tiến độ</button>
        </div>
      </div>`;
  }

  return `
    <button type="button" class="anki-flashcard ${flipped ? 'is-flipped' : ''}" aria-pressed="${flipped}" aria-label="${flipped ? 'Mặt sau' : 'Mặt trước'}: ${escapeHtml(card.korean)}. Nhấn để lật thẻ.">
      <span class="anki-card-status" aria-hidden="true">
        ${learned ? '<span class="anki-pill is-learned"><span class="material-icons-outlined">check_circle</span>Đã học</span>' : '<span class="anki-pill"><span class="material-icons-outlined">fiber_new</span>Mới</span>'}
        ${difficult ? '<span class="anki-pill is-hard"><span class="material-icons-outlined">priority_high</span>Cần ôn</span>' : ''}
      </span>
      <span class="anki-card-inner">
        ${FlashcardFront(card, flipped)}
        ${FlashcardBack(card, flipped)}
      </span>
    </button>`;
}
