// Cham diem hat.
// Cong thuc duy nhat, server la nguon su that:
//   diem vong = diem sao trung binh x (0,7 + 0,3 x do phu)
// - diem sao: 1..5, khach trong phong cham cho nguoi dang hat.
// - do phu: 0..1, ti le thoi gian mic cua nguoi hat vuot nguong
//   trong vong cham (client gui mau am luong, server tinh ti le).
// Hat chia thanh cac vong ngan 15 giay. Het bai: diem tong ket la
// trung binh cac vong, lam tron 1 chu so thap phan.

const ROUND_MS = 15000;

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// Diem 1 vong. stars: 1..5 (co the la trung binh), coverage: 0..1.
function computeRoundScore(stars, coverage) {
  const s = Math.max(1, Math.min(5, Number(stars) || 0));
  const c = clamp01(coverage);
  return Number((s * (0.7 + 0.3 * c)).toFixed(2));
}

// Diem tong ket 1 bai: trung binh cac vong, toi da 5.
function computeFinalScore(roundScores) {
  if (!Array.isArray(roundScores) || roundScores.length === 0) return 0;
  const sum = roundScores.reduce((a, b) => a + b, 0);
  return Number(Math.min(5, sum / roundScores.length).toFixed(1));
}

// Thuong xu theo diem tong ket (diem cang cao xu cang nhieu).
function coinsForScore(finalScore) {
  return Math.round(Number(finalScore || 0) * 10);
}

// Xep hang phong: sap xep giam dan theo tong diem, roi theo so bai da hat.
function rankLeaderboard(entries) {
  return [...entries].sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return b.songsSung - a.songsSung;
  });
}

// Phien cham 1 bai dang phat: gom cac vong 15 giay.
class ScoringSession {
  constructor({ songId, singerId, singerName }) {
    this.songId = songId;
    this.singerId = singerId;
    this.singerName = singerName;
    this.rounds = []; // { score, stars, coverage }
    this.current = this.newRound();
    this.starVotes = new Map(); // userId -> stars (moi nguoi 1 vote / vong)
    this.coverageSamples = []; // true/false: mic co vuot nguong khong
  }

  newRound() {
    return { startedAt: Date.now() };
  }

  // Khach cham sao cho vong hien tai (1..5). Moi nguoi chi 1 vote / vong.
  voteStars(userId, stars) {
    const s = Math.round(Number(stars));
    if (!Number.isFinite(s) || s < 1 || s > 5) {
      return { ok: false, reason: 'Sao phai tu 1 den 5.' };
    }
    this.starVotes.set(userId, s);
    return { ok: true };
  }

  // Client gui mau mic: true neu am luong vuot nguong trong khoang lay mau.
  addCoverageSample(active) {
    this.coverageSamples.push(active === true);
  }

  // Ket thuc 1 vong 15 giay: tinh do phu + diem sao trung binh -> diem vong.
  finishRound() {
    const samples = this.coverageSamples;
    const active = samples.filter(Boolean).length;
    const coverage = samples.length === 0 ? 0 : active / samples.length;
    const votes = [...this.starVotes.values()];
    const avgStars = votes.length === 0 ? 3 : votes.reduce((a, b) => a + b, 0) / votes.length;
    const score = computeRoundScore(avgStars, coverage);
    const round = { score, stars: Number(avgStars.toFixed(2)), coverage: Number(coverage.toFixed(2)) };
    this.rounds.push(round);
    this.starVotes = new Map();
    this.coverageSamples = [];
    this.current = this.newRound();
    return round;
  }

  isRoundDue(now = Date.now()) {
    return now - this.current.startedAt >= ROUND_MS;
  }

  finalScore() {
    return computeFinalScore(this.rounds.map((r) => r.score));
  }

  summary() {
    const finalScore = this.finalScore();
    return {
      songId: this.songId,
      singerId: this.singerId,
      singerName: this.singerName,
      rounds: this.rounds,
      finalScore,
      coins: coinsForScore(finalScore),
    };
  }
}

module.exports = {
  ROUND_MS,
  computeRoundScore,
  computeFinalScore,
  coinsForScore,
  rankLeaderboard,
  ScoringSession,
};
