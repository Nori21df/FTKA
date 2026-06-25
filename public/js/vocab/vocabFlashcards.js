import { useFlashcardQueue } from './useFlashcardQueue.js';
import { Flashcard } from './components/Flashcard.js';
import { FlashcardActions } from './components/FlashcardActions.js';
import { ProgressBar } from './components/ProgressBar.js';

const dataNode = document.getElementById('vocab-data');
const stage = document.getElementById('flashcardStage');
const actions = document.getElementById('flashcardActions');
const progress = document.getElementById('vocabProgress');
const metricLearned = document.getElementById('metricLearned');
const metricUnlearned = document.getElementById('metricUnlearned');

let cards = [];
try { cards = JSON.parse(dataNode?.textContent || '[]'); } catch (_) { cards = []; }

const queue = useFlashcardQueue(cards);
let flipped = false;
let busy = false;
let rotation = 0;
let rafId = 0;

const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

function animateSpring(inner, target) {
  if (!inner) return;
  cancelAnimationFrame(rafId);
  if (prefersReducedMotion) {
    rotation = target;
    inner.style.transform = `rotateY(${target}deg)`;
    return;
  }

  // Framer Motion-style spring: stiffness/damping/mass, no scaling -> no blurry text artifacts.
  const stiffness = 420;
  const damping = 36;
  const mass = 1;
  let velocity = 0;
  let last = performance.now();

  const tick = (time) => {
    const dt = Math.min((time - last) / 1000, 0.032);
    last = time;
    const displacement = rotation - target;
    const force = (-stiffness * displacement) - (damping * velocity);
    velocity += (force / mass) * dt;
    rotation += velocity * dt;
    inner.style.transform = `rotateY(${rotation}deg)`;

    if (Math.abs(rotation - target) > 0.08 || Math.abs(velocity) > 0.08) {
      rafId = requestAnimationFrame(tick);
    } else {
      rotation = target;
      inner.style.transform = `rotateY(${target}deg)`;
    }
  };

  rafId = requestAnimationFrame(tick);
}

function setFlipState(animate = true) {
  const card = stage?.querySelector('.anki-flashcard');
  const inner = stage?.querySelector('.anki-card-inner');
  const front = stage?.querySelector('.anki-card-front');
  const back = stage?.querySelector('.anki-card-back');
  const actionBar = actions?.querySelector('.anki-actions');
  const gatedButtons = actions?.querySelectorAll('[data-action="learned"], [data-action="review"]') || [];
  const targetRotation = flipped ? 180 : 0;

  card?.classList.toggle('is-flipped', flipped);
  card?.setAttribute('aria-pressed', String(flipped));
  front?.setAttribute('aria-hidden', String(flipped));
  back?.setAttribute('aria-hidden', String(!flipped));
  actionBar?.classList.toggle('is-visible', flipped);
  gatedButtons.forEach((button) => {
    button.disabled = !flipped;
    button.setAttribute('aria-disabled', String(!flipped));
  });

  if (!inner) return;
  if (animate) animateSpring(inner, targetRotation);
  else {
    cancelAnimationFrame(rafId);
    rotation = targetRotation;
    inner.style.transform = `rotateY(${targetRotation}deg)`;
  }
}

function render() {
  const card = queue.card;
  const stats = queue.progress();
  if (progress) progress.innerHTML = ProgressBar(stats);
  if (stage) stage.innerHTML = Flashcard({ card, flipped, learned: card ? queue.isLearned(card.id) : false, difficult: card ? queue.isDifficult(card.id) : false, stats });
  if (actions) actions.innerHTML = card ? FlashcardActions(flipped) : '';
  if (metricLearned) metricLearned.textContent = stats.learned;
  if (metricUnlearned) metricUnlearned.textContent = stats.remaining;
  setFlipState(false);
}

function flip() {
  if (!queue.card || busy) return;
  flipped = !flipped;
  setFlipState(true);
}

async function run(action) {
  if (busy) return;
  try {
    busy = true;
    if (action === 'learned') {
      if (!flipped) return;
      await queue.markLearned();
      window.showToast?.('Đã lưu: Đã học.', 'success');
    }
    if (action === 'review') {
      if (!flipped) return;
      queue.reviewAgain();
      window.showToast?.('Đã thêm vào hàng ôn lại.', 'info');
    }
    if (action === 'skip') queue.skip();
    if (action === 'random') queue.random();
    if (action === 'review-learned') {
      queue.reviewLearnedWords();
      window.showToast?.('Đang ôn lại từ đã học.', 'info');
    }
    if (action === 'normal-study') queue.normalStudy();
    if (action === 'reset-progress') {
      await window.resetLearned?.();
      return;
    }
  } catch (error) {
    window.showToast?.(error.message || 'Thao tác thất bại.', 'error');
  } finally {
    flipped = false;
    rotation = 0;
    busy = false;
    render();
  }
}

stage?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (button) {
    event.preventDefault();
    run(button.dataset.action);
    return;
  }
  if (event.target.closest('.anki-flashcard')) flip();
});

actions?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  run(button.dataset.action);
});

document.addEventListener('keydown', (event) => {
  const target = event.target;
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
  const key = event.key.toLowerCase();
  if (event.code === 'Space') { event.preventDefault(); flip(); }
  if (key === 'a') run('learned');
  if (key === 'r') run('review');
  if (key === 's') run('skip');
  if (key === 'd') run('random');
});

render();
