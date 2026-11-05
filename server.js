// Server that cho game karaoke online nhieu may choi chung.
// Stack: Node.js + Express + Socket.IO. Server la nguon su that:
// khong gian, ghe, hang cho, chat, diem, qua deu do server quyet.
//
// Chi co 2 khong gian:
// - 'karaoke': 1 phong karaoke duy nhat (hang cho bai hat, cham diem,
//   qua, goc may, co vu). Chu phong co quyen Qua bai truc tiep.
// - 'cinema': rap ngoai troi xem phim chung (hang cho video, mic mo
//   noi chuyen, khong hat, khong cham diem, khong qua).
//
// Hang cho video + bo phieu skip ap cho CA 2 khong gian:
// - Ai cung de xuat video (tim YouTube hoac dan link), toi da 3 video
//   dang cho/nguoi, luan phien giua cac nguoi de xuat.
// - Bo phieu skip: dat DA SO nguoi duoc quyen vote thi tu qua video
//   tiep theo. Phong karaoke KHONG tinh nguoi dang hat bai do;
//   rap phim tinh tat ca nguoi dang trong rap. Phieu reset khi doi video.

require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const { SpaceManager } = require('./src/rooms');
const { SongQueue, majorityNeeded } = require('./src/queue');
const { ScoringSession } = require('./src/scoring');
const chat = require('./src/chat');
const youtube = require('./src/youtube');
const livekit = require('./src/livekit');

const PORT = Number(process.env.PORT || 3000);
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

const spaces = new SpaceManager();

// Hang cho rieng cho tung khong gian (cung luat: toi da 3/nguoi, luan phien).
const karaokeQueue = new SongQueue();
const cinemaQueue = new SongQueue();
function queueOf(space) {
  return space.mode === 'cinema' ? cinemaQueue : karaokeQueue;
}

// Chi phong karaoke moi co cham diem / bang xep hang / diem ung ho.
let karaokeScoring = null;
const karaokeLeaderboard = new Map(); // userId -> { userId, name, totalScore, songsSung, coins }
const karaokeSupport = new Map(); // singerId -> support points

// Ten ngau nhien cho khach chua dat ten.
const RANDOM_NAMES = [
  'Ca Si Tre', 'Giong Hat Vang', 'Sao Mai', 'Hat Hay', 'Giong Ca Dem',
  'Sao Dem', 'Hat Rong', 'Giong Hat Que', 'Ca Si Phong Trao', 'Hat Vui',
];
function randomName() {
  return `${RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]} ${Math.floor(100 + Math.random() * 900)}`;
}

function idlePlayback() {
  return { videoId: null, title: null, singerId: null, singerName: null, startedAt: null, status: 'idle' };
}

// So nguoi duoc quyen vote skip hien tai trong 1 khong gian.
// Karaoke: tru nguoi dang hat bai do. Rap phim: tinh tat ca.
function skipEligibleCount(space) {
  let n = space.players.size;
  if (space.mode === 'karaoke' && space.playback.singerId) n -= 1;
  return Math.max(0, n);
}

// Trang thai day du cua 1 khong gian gui cho client khi vao.
function spaceStateFor(space) {
  const view = spaces.publicView(space);
  const base = {
    ...view,
    serverNow: Date.now(),
    queue: queueOf(space).publicList(),
    skipVotes: queueOf(space).skipVoteCount(),
    skipNeeded: majorityNeeded(skipEligibleCount(space)),
  };
  if (space.mode === 'karaoke') {
    return {
      ...base,
      leaderboard: [...karaokeLeaderboard.values()],
      support: Object.fromEntries(karaokeSupport.entries()),
    };
  }
  return base;
}

function broadcastSpace(space) {
  io.to(space.id).emit('space-state', spaceStateFor(space));
}

// ---------- Phat video ke tiep tu hang cho (ca 2 khong gian) ----------

function startNextFromQueue(space) {
  const queue = queueOf(space);
  const next = queue.pickNext();
  if (!next) {
    space.playback = idlePlayback();
    if (space.mode === 'karaoke') karaokeScoring = null;
    return null;
  }
  space.playback = {
    videoId: next.videoId,
    title: next.title,
    singerId: space.mode === 'karaoke' ? next.addedBy : null,
    singerName: space.mode === 'karaoke' ? next.addedByName : null,
    startedAt: Date.now(),
    status: 'playing',
  };
  queue.clearSkipVotes();
  if (space.mode === 'karaoke') {
    karaokeScoring = new ScoringSession({
      songId: next.id,
      singerId: next.addedBy,
      singerName: next.addedByName,
    });
  }
  return next;
}

// ---------- Karaoke: cham diem ----------

// Ket thuc bai dang phat: chot diem, cong xu, cap nhat bang xep hang.
function finishCurrentSong(space, reason = 'ended') {
  const session = karaokeScoring;
  const playback = space.playback;
  if (!session || !playback.videoId) return null;
  // Chot vong dang do neu co mau mic.
  if (session.coverageSamples.length > 0 || session.starVotes.size > 0) {
    session.finishRound();
  }
  const summary = session.summary();
  karaokeScoring = null;
  const entry = karaokeLeaderboard.get(summary.singerId) || {
    userId: summary.singerId,
    name: summary.singerName,
    totalScore: 0,
    songsSung: 0,
    coins: 0,
  };
  entry.totalScore = Number((entry.totalScore + summary.finalScore).toFixed(1));
  entry.songsSung += 1;
  entry.coins += summary.coins;
  karaokeLeaderboard.set(summary.singerId, entry);
  const singer = space.players.get(summary.singerId);
  if (singer) singer.coins = (singer.coins || 0) + summary.coins;
  return { ...summary, reason };
}

// Vong cham diem 15 giay: kiem tra moi giay khi phong karaoke dang hat.
setInterval(() => {
  const now = Date.now();
  if (!karaokeScoring || !karaokeScoring.isRoundDue(now)) return;
  const round = karaokeScoring.finishRound();
  io.to('karaoke').emit('round-score', {
    songId: karaokeScoring.songId,
    singerId: karaokeScoring.singerId,
    round,
    roundsSoFar: karaokeScoring.rounds.length,
  });
}, 1000);

// ---------- REST API ----------

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    spaces: spaces.listSpaces().length,
    players: [...spaces.spaces.values()].reduce((n, s) => n + s.players.size, 0),
    uptimeSeconds: Math.round(process.uptime()),
    youtubeConfigured: youtube.isConfigured(YOUTUBE_API_KEY),
    livekitConfigured: livekit.isConfigured(livekit.livekitConfig()),
  });
});

app.get('/api/spaces', (req, res) => {
  res.json(spaces.listSpaces());
});

// Danh muc dung chung cho client: qua tang, trang phuc, emote.
app.get('/api/meta', (req, res) => {
  res.json({
    gifts: chat.GIFTS,
    outfits: chat.OUTFITS,
    emotes: chat.EMOTES,
  });
});

// Tim video (server tu them hau to "karaoke" khi tim bai hat).
app.get('/api/search', async (req, res) => {
  try {
    const results = await youtube.searchYouTube(YOUTUBE_API_KEY, req.query.q || '', 8);
    res.json({ ok: true, results });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Cap token LiveKit cho mic. Neu chua cau hinh thi tra enabled: false.
app.post('/api/livekit-token', async (req, res) => {
  try {
    const result = await livekit.createToken({
      identity: String(req.body.identity || 'guest'),
      name: String(req.body.name || 'Khach'),
      roomName: String(req.body.room || 'karaoke'),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ enabled: false, reason: `Khong cap duoc token LiveKit: ${err.message}` });
  }
});

// ---------- Socket.IO ----------

io.on('connection', (socket) => {
  let currentSpace = null;
  let player = null;

  socket.emit('hello', {
    socketId: socket.id,
    suggestedName: randomName(),
    serverNow: Date.now(),
    livekitEnabled: livekit.isConfigured(livekit.livekitConfig()),
    youtubeConfigured: youtube.isConfigured(YOUTUBE_API_KEY),
  });

  socket.on('list-spaces', () => {
    socket.emit('spaces-list', spaces.listSpaces());
  });

  socket.on('join-space', ({ spaceId, name, avatar, isGuest }) => {
    const space = spaces.getSpace(spaceId);
    if (!space) {
      socket.emit('error-message', 'Khong gian khong ton tai.');
      return;
    }
    if (currentSpace && currentSpace.id !== space.id) {
      leaveCurrentSpace();
    }
    currentSpace = space;
    const cleanName = String(name || '').trim().slice(0, 40);
    player = {
      id: socket.id,
      name: cleanName || randomName(),
      avatar: avatar && typeof avatar === 'object' ? avatar : {},
      isGuest: isGuest === true || !cleanName,
      seatId: null,
      coins: 100,
      // Chi phong karaoke moi co chu phong (nguoi vao dau tien).
      isHost: space.mode === 'karaoke' && space.players.size === 0,
    };
    spaces.addPlayer(space, player);
    socket.join(space.id);
    socket.emit('joined-space', { space: spaceStateFor(space), you: { ...player } });
    socket.to(space.id).emit('player-joined', { ...player });
    broadcastSpace(space);
  });

  function leaveCurrentSpace() {
    if (!currentSpace || !player) return;
    const space = currentSpace;
    const wasSinger = space.mode === 'karaoke' && space.playback.singerId === socket.id;
    const wasHost = player.isHost;
    // Nguoi roi di thi phieu skip cua ho cung bi xoa.
    queueOf(space).removeSkipVote(socket.id);
    spaces.removePlayer(space, socket.id);
    socket.leave(space.id);
    if (wasSinger && space.playback.videoId) {
      const summary = finishCurrentSong(space, 'singer-left');
      if (summary) io.to(space.id).emit('score-announce', summary);
      startNextFromQueue(space);
    }
    if (wasHost && space.players.size > 0) {
      const nextHost = [...space.players.values()][0];
      nextHost.isHost = true;
      io.to(space.id).emit('host-changed', { hostId: nextHost.id, hostName: nextHost.name });
    }
    currentSpace = null;
    player = null;
    broadcastSpace(space);
  }

  socket.on('leave-space', () => leaveCurrentSpace());

  socket.on('select-seat', (seatId) => {
    if (!currentSpace || !player) return;
    const result = spaces.assignSeat(currentSpace, socket.id, seatId);
    if (!result.ok) {
      socket.emit('error-message', result.reason);
      return;
    }
    broadcastSpace(currentSpace);
  });

  socket.on('update-profile', ({ name, avatar }) => {
    if (!currentSpace || !player) return;
    const cleanName = String(name || '').trim().slice(0, 40);
    if (cleanName) {
      player.name = cleanName;
      player.isGuest = false;
    }
    if (avatar && typeof avatar === 'object') player.avatar = avatar;
    broadcastSpace(currentSpace);
  });

  function requireKaraoke() {
    if (!currentSpace || currentSpace.mode !== 'karaoke') {
      socket.emit('error-message', 'Chuc nang nay chi co o phong karaoke.');
      return false;
    }
    return true;
  }

  // ---------- Hang cho video (ca 2 khong gian) ----------
  // De xuat video: tim YouTube hoac dan link. Toi da 3 video dang cho/nguoi.
  function proposeVideo({ videoId, title, channel }) {
    if (!currentSpace || !player) return;
    if (player.isGuest) {
      socket.emit('error-message', 'Hay dat ten truoc khi de xuat video.');
      return;
    }
    const vid = youtube.extractVideoId(videoId) || String(videoId || '').trim();
    const result = queueOf(currentSpace).add({
      videoId: vid,
      title,
      channel,
      addedBy: socket.id,
      addedByName: player.name,
    });
    if (!result.ok) {
      socket.emit('error-message', result.reason);
      return;
    }
    // Rap phim: neu dang khong chieu gi thi video vua de xuat chay ngay.
    if (currentSpace.mode === 'cinema' && !currentSpace.playback.videoId) {
      startNextFromQueue(currentSpace);
    }
    broadcastSpace(currentSpace);
  }

  // Phong karaoke: them bai vao hang cho.
  socket.on('queue-add', (data) => proposeVideo(data));

  // Rap phim: de xuat video vao hang cho.
  socket.on('cinema-add', (data) => proposeVideo(data));

  function removeProposed(songId, isHost) {
    if (!currentSpace || !player) return;
    const result = queueOf(currentSpace).remove(songId, socket.id, isHost);
    if (!result.ok) {
      socket.emit('error-message', result.reason);
      return;
    }
    broadcastSpace(currentSpace);
  }

  socket.on('queue-remove', (songId) => {
    if (!currentSpace || !requireKaraoke()) return;
    removeProposed(songId, player.isHost);
  });

  socket.on('cinema-remove', (songId) => {
    if (!currentSpace || currentSpace.mode !== 'cinema') return;
    removeProposed(songId, false);
  });

  function voteProposed(songId) {
    if (!currentSpace || !player) return;
    const result = queueOf(currentSpace).vote(songId, socket.id);
    if (!result.ok) {
      socket.emit('error-message', result.reason);
      return;
    }
    broadcastSpace(currentSpace);
  }

  socket.on('queue-vote', (songId) => {
    if (!currentSpace || !requireKaraoke()) return;
    voteProposed(songId);
  });

  socket.on('cinema-vote', (songId) => {
    if (!currentSpace || currentSpace.mode !== 'cinema') return;
    voteProposed(songId);
  });

  // ---------- Phong karaoke: dieu khien bai hat ----------

  // Chu phong bat bai tiep theo (khi dang khong co bai nao phat).
  socket.on('play-next', () => {
    if (!currentSpace || !player || !requireKaraoke()) return;
    if (!player.isHost && currentSpace.playback.videoId) {
      socket.emit('error-message', 'Chi chu phong moi bat bai khi dang co bai phat.');
      return;
    }
    if (currentSpace.playback.videoId) return;
    const next = startNextFromQueue(currentSpace);
    if (!next) {
      socket.emit('error-message', 'Hang cho dang trong, hay them bai truoc.');
      return;
    }
    broadcastSpace(currentSpace);
  });

  // Chu phong (hoac nguoi dang hat) Qua bai truc tiep, khong can phieu.
  socket.on('skip-song', () => {
    if (!currentSpace || !player || !requireKaraoke()) return;
    const isSinger = currentSpace.playback.singerId === socket.id;
    if (!player.isHost && !isSinger) {
      socket.emit('error-message', 'Chi chu phong hoac nguoi dang hat moi qua bai truc tiep duoc. Hay bam bo phieu skip.');
      return;
    }
    const summary = finishCurrentSong(currentSpace, 'skipped');
    if (summary) io.to(currentSpace.id).emit('score-announce', summary);
    startNextFromQueue(currentSpace);
    io.to(currentSpace.id).emit('skip-announce', {
      reason: 'host-skip',
      byName: player.name,
      title: currentSpace.playback.title,
    });
    broadcastSpace(currentSpace);
  });

  // Dung bai: chot diem, ve trang thai cho, khong tu phat bai ke.
  socket.on('stop-song', () => {
    if (!currentSpace || !player || !requireKaraoke()) return;
    const isSinger = currentSpace.playback.singerId === socket.id;
    if (!player.isHost && !isSinger) {
      socket.emit('error-message', 'Chi chu phong hoac nguoi dang hat moi dung bai duoc.');
      return;
    }
    const summary = finishCurrentSong(currentSpace, 'stopped');
    if (summary) io.to(currentSpace.id).emit('score-announce', summary);
    currentSpace.playback = idlePlayback();
    broadcastSpace(currentSpace);
  });

  // ---------- Bo phieu skip (ca 2 khong gian, 1 su kien chung) ----------
  socket.on('vote-skip', () => {
    if (!currentSpace || !player) return;
    if (!currentSpace.playback.videoId) {
      socket.emit('error-message', 'Dang khong co video nao de skip.');
      return;
    }
    if (player.isGuest) {
      socket.emit('error-message', 'Hay dat ten truoc khi bo phieu skip.');
      return;
    }
    // Phong karaoke: nguoi dang hat khong duoc vote skip bai cua minh.
    if (currentSpace.mode === 'karaoke' && currentSpace.playback.singerId === socket.id) {
      socket.emit('error-message', 'Nguoi dang hat khong duoc vote skip bai cua minh.');
      return;
    }
    const queue = queueOf(currentSpace);
    const result = queue.voteSkip(socket.id, skipEligibleCount(currentSpace));
    if (result.reached) {
      const skippedTitle = currentSpace.playback.title;
      if (currentSpace.mode === 'karaoke') {
        const summary = finishCurrentSong(currentSpace, 'voted-skip');
        if (summary) io.to(currentSpace.id).emit('score-announce', summary);
      }
      startNextFromQueue(currentSpace);
      io.to(currentSpace.id).emit('skip-announce', {
        reason: 'voted-skip',
        votes: result.votes,
        needed: result.needed,
        title: skippedTitle,
      });
    }
    broadcastSpace(currentSpace);
  });

  // ---------- Rap ngoai troi: dieu khien phim ----------

  // Phat video tiep theo trong hang cho (khi dang khong chieu gi).
  socket.on('cinema-play-next', () => {
    if (!currentSpace || !player) return;
    if (currentSpace.mode !== 'cinema') return;
    if (currentSpace.playback.videoId) return;
    const next = startNextFromQueue(currentSpace);
    if (!next) {
      socket.emit('error-message', 'Hang cho dang trong, hay de xuat video truoc.');
      return;
    }
    broadcastSpace(currentSpace);
  });

  socket.on('cinema-stop', () => {
    if (!currentSpace || !player) return;
    if (currentSpace.mode !== 'cinema') return;
    currentSpace.playback = idlePlayback();
    broadcastSpace(currentSpace);
  });

  // Trang thai trinh phat YouTube tu client (ended, playing, paused, buffering, ad).
  socket.on('player-state', ({ state }) => {
    if (!currentSpace || !player) return;
    // Rap phim: het phim thi tu chay video tiep theo trong hang cho (neu co).
    if (currentSpace.mode === 'cinema') {
      if (state === 'ended' && currentSpace.playback.videoId) {
        startNextFromQueue(currentSpace);
        broadcastSpace(currentSpace);
      }
      return;
    }
    // Karaoke: chi nguoi dang hat moi bao trang thai trinh phat.
    if (currentSpace.playback.singerId !== socket.id) return;
    if (state === 'ended') {
      const summary = finishCurrentSong(currentSpace, 'ended');
      if (summary) io.to(currentSpace.id).emit('score-announce', summary);
      startNextFromQueue(currentSpace);
      broadcastSpace(currentSpace);
      return;
    }
    if (state === 'playing' || state === 'paused') {
      currentSpace.playback.status = state;
      io.to(currentSpace.id).emit('playback-status', { status: state, serverNow: Date.now() });
    }
    if (state === 'buffering' || state === 'ad') {
      currentSpace.playback.status = 'waiting-ad';
      io.to(currentSpace.id).emit('playback-status', { status: 'waiting-ad', serverNow: Date.now() });
    }
  });

  // Mau mic cua nguoi hat karaoke (true = am luong vuot nguong trong khoang lay mau).
  socket.on('mic-sample', ({ active }) => {
    if (!currentSpace || currentSpace.mode !== 'karaoke') return;
    if (karaokeScoring && karaokeScoring.singerId === socket.id) {
      karaokeScoring.addCoverageSample(active === true);
    }
  });

  // Khach cham sao 1..5 cho vong hien tai (chi phong karaoke).
  socket.on('vote-stars', (stars) => {
    if (!currentSpace || currentSpace.mode !== 'karaoke') return;
    if (!karaokeScoring) return;
    const result = karaokeScoring.voteStars(socket.id, stars);
    if (!result.ok) socket.emit('error-message', result.reason);
  });

  socket.on('chat-message', ({ text, kind }) => {
    if (!currentSpace || !player) return;
    if (player.isGuest) {
      socket.emit('error-message', 'Hay dat ten truoc khi chat.');
      return;
    }
    const msg = chat.makeChatMessage({
      userId: socket.id,
      userName: player.name,
      avatar: player.avatar,
      text,
      kind: kind === 'emote' ? 'emote' : 'text',
    });
    if (!msg) return;
    io.to(currentSpace.id).emit('chat-message', msg);
  });

  // Loi co vu chieu len man hinh chung (chi phong karaoke).
  socket.on('cheer', ({ text }) => {
    if (!currentSpace || !player) return;
    if (currentSpace.mode !== 'karaoke') {
      socket.emit('error-message', 'Co vu chi co o phong karaoke.');
      return;
    }
    if (player.isGuest) {
      socket.emit('error-message', 'Hay dat ten truoc khi co vu.');
      return;
    }
    const cheer = chat.makeCheer({ userId: socket.id, userName: player.name, text });
    if (!cheer) return;
    io.to(currentSpace.id).emit('cheer', cheer);
  });

  socket.on('send-gift', (giftId) => {
    if (!currentSpace || !player) return;
    if (currentSpace.mode !== 'karaoke') {
      socket.emit('error-message', 'Rap phim khong co tang qua.');
      return;
    }
    const result = chat.sendGift({
      giftId,
      fromUser: player,
      singerId: currentSpace.playback.singerId,
      singerSupportMap: karaokeSupport,
    });
    if (!result.ok) {
      socket.emit('error-message', result.reason);
      return;
    }
    io.to(currentSpace.id).emit('gift', {
      fromId: player.id,
      fromName: player.name,
      singerId: currentSpace.playback.singerId,
      gift: result.gift,
      singerSupport: result.singerSupport,
      newlyUnlocked: result.newlyUnlocked,
    });
    socket.emit('coins-update', { coins: player.coins });
    broadcastSpace(currentSpace);
  });

  socket.on('disconnect', () => leaveCurrentSpace());
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Karaoke Online server dang chay: http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`YouTube search: ${youtube.isConfigured(YOUTUBE_API_KEY) ? 'da cau hinh' : 'CHUA cau hinh key (tim kiem se bao loi, dan link van duoc)'}`);
  // eslint-disable-next-line no-console
  console.log(`LiveKit voice: ${livekit.isConfigured(livekit.livekitConfig()) ? 'da cau hinh' : 'CHUA cau hinh (mic se tat, phong van chay)'}`);
});
