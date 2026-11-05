// Hang cho video/bai hat cua 1 khong gian (dung chung cho ca phong karaoke
// lan rap ngoai troi xem phim).
// Quy tac:
// - Moi nguoi toi da 3 video/bai trong hang cho.
// - Luan phien: bai ke tiep luon lay tu nguoi khac nguoi vua hat/xem xong
//   (neu co), de khong ai chiem lien 2 luot khi co nhieu nguoi cho.
// - Binh chon video tiep theo: video nao nhieu vote nhat trong so cac video
//   cua nguoi den luot se duoc chon.
// - Bo phieu skip: nguoi dang xem/nghe duoc bam "bo phieu skip" cho video
//   dang phat; khi so phieu dat DA SO nguoi duoc quyen vote thi tu qua
//   video tiep theo. So nguoi duoc quyen vote do server truyen vao:
//   phong karaoke khong tinh nguoi dang hat bai do, rap phim tinh tat ca
//   nguoi dang trong rap. Phieu reset khi doi video.

const MAX_SONGS_PER_USER = 3;

// Da so tuyet doi: can hon mot nua so nguoi duoc quyen vote.
// Vi du: 4 nguoi -> can 3 phieu; 5 nguoi -> can 3 phieu; 1 nguoi -> can 1 phieu.
function majorityNeeded(eligibleCount) {
  const n = Math.max(0, Math.floor(Number(eligibleCount) || 0));
  return Math.floor(n / 2) + 1;
}

let songCounter = 0;

function nextSongId() {
  songCounter += 1;
  return `song-${Date.now().toString(36)}-${songCounter}`;
}

class SongQueue {
  constructor() {
    this.items = []; // { id, videoId, title, channel, addedBy, addedByName, addedAt, votes: Set }
    this.lastSingerId = null;
    this.skipVotes = new Set(); // socketId vote tua/bo qua bai dang phat
  }

  countByUser(userId) {
    return this.items.filter((s) => s.addedBy === userId).length;
  }

  // Them bai vao hang cho. Tra ve { ok, song } hoac { ok: false, reason }.
  add({ videoId, title, channel, addedBy, addedByName }) {
    if (!videoId || typeof videoId !== 'string') {
      return { ok: false, reason: 'Thieu videoId.' };
    }
    if (this.countByUser(addedBy) >= MAX_SONGS_PER_USER) {
      return { ok: false, reason: `Moi nguoi chi duoc cho toi da ${MAX_SONGS_PER_USER} bai.` };
    }
    const song = {
      id: nextSongId(),
      videoId: videoId.trim(),
      title: String(title || videoId).slice(0, 120),
      channel: String(channel || '').slice(0, 80),
      addedBy,
      addedByName: String(addedByName || 'Khach').slice(0, 40),
      addedAt: Date.now(),
      votes: new Set(),
    };
    this.items.push(song);
    return { ok: true, song: this.publicSong(song) };
  }

  remove(songId, userId, isHost) {
    const i = this.items.findIndex((s) => s.id === songId);
    if (i === -1) return { ok: false, reason: 'Khong tim thay bai.' };
    const song = this.items[i];
    if (song.addedBy !== userId && !isHost) {
      return { ok: false, reason: 'Chi nguoi them bai hoac chu phong moi xoa duoc.' };
    }
    this.items.splice(i, 1);
    return { ok: true, song: this.publicSong(song) };
  }

  // Binh chon bai tiep theo (moi nguoi 1 vote cho 1 bai tai 1 thoi diem).
  vote(songId, userId) {
    const song = this.items.find((s) => s.id === songId);
    if (!song) return { ok: false, reason: 'Khong tim thay bai.' };
    for (const s of this.items) s.votes.delete(userId);
    song.votes.add(userId);
    return { ok: true, song: this.publicSong(song) };
  }

  // Chon bai ke tiep theo luan phien + vote.
  // Uu tien bai cua nguoi khac nguoi vua hat; trong nhom do chon bai nhieu vote nhat.
  pickNext() {
    if (this.items.length === 0) return null;
    const others = this.items.filter((s) => s.addedBy !== this.lastSingerId);
    const pool = others.length > 0 ? others : this.items;
    let best = pool[0];
    for (const s of pool) {
      if (s.votes.size > best.votes.size) best = s;
      if (s.votes.size === best.votes.size && s.addedAt < best.addedAt && s !== best) best = s;
    }
    const i = this.items.indexOf(best);
    this.items.splice(i, 1);
    this.lastSingerId = best.addedBy;
    return this.publicSong(best);
  }

  // Bo phieu skip video dang phat. Moi nguoi 1 phieu.
  // eligibleCount = so nguoi duoc quyen vote (server tinh: karaoke tru
  // nguoi dang hat, rap phim tinh tat ca). Tra ve { reached, votes, needed }.
  voteSkip(userId, eligibleCount) {
    this.skipVotes.add(userId);
    const needed = majorityNeeded(eligibleCount);
    return { reached: this.skipVotes.size >= needed, votes: this.skipVotes.size, needed };
  }

  // So phieu can de skip voi so nguoi duoc quyen vote hien tai.
  skipNeededFor(eligibleCount) {
    return majorityNeeded(eligibleCount);
  }

  // Xoa phieu skip cua 1 nguoi (khi nguoi do roi khoi khong gian).
  removeSkipVote(userId) {
    this.skipVotes.delete(userId);
  }

  // Phieu reset khi doi video.
  clearSkipVotes() {
    this.skipVotes.clear();
  }

  skipVoteCount() {
    return this.skipVotes.size;
  }

  publicSong(song) {
    return {
      id: song.id,
      videoId: song.videoId,
      title: song.title,
      channel: song.channel,
      addedBy: song.addedBy,
      addedByName: song.addedByName,
      addedAt: song.addedAt,
      votes: song.votes.size,
    };
  }

  publicList() {
    return this.items.map((s) => this.publicSong(s));
  }

  get length() {
    return this.items.length;
  }
}

module.exports = { SongQueue, MAX_SONGS_PER_USER, majorityNeeded };
