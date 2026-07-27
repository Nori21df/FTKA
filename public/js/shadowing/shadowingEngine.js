// Logic thuần cho bài luyện Shadowing: quản lý câu, vòng luyện và điểm số.

function normalizeRounds(value) {
    const rounds = Number.parseInt(value, 10);
    return Number.isFinite(rounds) && rounds > 0 ? rounds : 1;
}

function normalizeScore(value) {
    const score = Number(value);
    return Number.isFinite(score) ? Math.min(100, Math.max(0, score)) : 0;
}

export class ShadowingEngine {
    constructor(sentences = [], totalRounds = 1) {
        this.sentences = Array.isArray(sentences) ? [...sentences] : [];
        this.totalRounds = normalizeRounds(totalRounds);
        this.reset();
    }

    get currentSentence() {
        return this.sentences[this.index] || null;
    }

    get currentIndex() {
        return this.index;
    }

    get currentRound() {
        return this.round;
    }

    get isComplete() {
        return this.completed;
    }

    get attempts() {
        return this.scores;
    }

    setRounds(totalRounds) {
        this.totalRounds = normalizeRounds(totalRounds);
        this.round = Math.min(this.round, this.totalRounds);
        return this.snapshot();
    }

    recordAttempt(score) {
        if (!this.currentSentence || this.completed) {
            return this.snapshot('done');
        }

        const normalizedScore = normalizeScore(score);
        const sentenceIndex = this.index;
        this.scores[sentenceIndex].push(normalizedScore);
        const previousBest = this.bestScores[sentenceIndex];
        this.bestScores[sentenceIndex] = previousBest == null
            ? normalizedScore
            : Math.max(previousBest, normalizedScore);

        return this.advance();
    }

    advance() {
        if (!this.currentSentence || this.completed) {
            return this.snapshot('done');
        }

        if (this.round < this.totalRounds) {
            this.round += 1;
            return this.snapshot('round');
        }

        if (this.index < this.sentences.length - 1) {
            this.index += 1;
            this.round = 1;
            return this.snapshot('sentence');
        }

        this.completed = true;
        return this.snapshot('done');
    }

    prev() {
        if (!this.sentences.length) {
            return this.snapshot();
        }

        if (this.index > 0) {
            this.index -= 1;
        }
        this.round = 1;
        this.completed = false;
        return this.snapshot();
    }

    previous() {
        return this.prev();
    }

    next() {
        if (!this.sentences.length) {
            return this.snapshot();
        }

        if (this.index < this.sentences.length - 1) {
            this.index += 1;
        }
        this.round = 1;
        this.completed = false;
        return this.snapshot();
    }

    reset() {
        this.index = 0;
        this.round = 1;
        this.completed = this.sentences.length === 0;
        this.scores = this.sentences.map(() => []);
        this.bestScores = this.sentences.map(() => null);
        return this.snapshot();
    }

    averageScore() {
        const recordedScores = this.bestScores.filter((score) => score != null);
        if (!recordedScores.length) {
            return 0;
        }

        const total = recordedScores.reduce((sum, score) => sum + score, 0);
        return total / recordedScores.length;
    }

    snapshot(transition = null) {
        return {
            transition,
            index: this.index,
            round: this.round,
            totalRounds: this.totalRounds,
            completed: this.completed,
            currentSentence: this.currentSentence,
            bestScore: this.bestScores?.[this.index] ?? null
        };
    }
}

export function createShadowingEngine(sentences, totalRounds) {
    return new ShadowingEngine(sentences, totalRounds);
}

export default ShadowingEngine;
