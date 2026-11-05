// Client cho game karaoke online.
// Ket noi Socket.IO + LiveKit + YouTube IFrame API.
// Chi co 2 khong gian: phong karaoke duy nhat + rap ngoai troi xem phim.
// SanH va phong 2D render doc lap voi Three.js: neu CDN 3D loi thi
// tu dung san khau 2D, bao loi than thien trong trang (khong man hinh den).

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SYNC_THRESHOLD = 1.5;

  // ---------- Trang thai ----------
  const state = {
    socket: null,
    socketId: null,
    serverNow: 0,
    clockOffset: 0,
    me: { name: '', avatar: {}, isGuest: true, coins: 100, isHost: false },
    space: null,
    currentVideoId: null,
    ytPlayer: null,
    ytReady: false,
    ytFailed: false,
    three: null,
    livekitRoom: null,
    livekitEnabled: false,
    micTrack: null,
    micAnalyser: null,
    micLevel: 0,
    pttHeld: false,
    headphoneMode: false,
    gifts: [],
    emotes: [],
    settings: { subtitles: true, laser: true, quality: 'high', hideButtons: false },
  };

  function showNotice(text) {
    const n = $('notice');
    n.textContent = text;
    n.hidden = !text;
  }

  function loadProfile() {
    try {
      const saved = JSON.parse(localStorage.getItem('karaoke-profile') || '{}');
      if (saved.name) $('input-name').value = saved.name;
      if (saved.avatar) {
        if (saved.avatar.hair) $('select-hair').value = saved.avatar.hair;
        if (saved.avatar.hairColor) $('input-hair-color').value = saved.avatar.hairColor;
        if (saved.avatar.skin) $('select-skin').value = saved.avatar.skin;
        if (saved.avatar.shirtColor) $('input-shirt-color').value = saved.avatar.shirtColor;
        if (saved.avatar.accessory) $('select-accessory').value = saved.avatar.accessory;
      }
    } catch (e) { /* bo qua profile hong */ }
    try {
      const s = JSON.parse(localStorage.getItem('karaoke-settings') || '{}');
      state.settings = { ...state.settings, ...s };
    } catch (e) { /* bo qua cai dat hong */ }
  }

  function readAvatar() {
    return {
      hair: $('select-hair').value,
      hairColor: $('input-hair-color').value,
      skin: $('select-skin').value,
      shirtColor: $('input-shirt-color').value,
      accessory: $('select-accessory').value,
    };
  }

  function saveProfile() {
    try {
      localStorage.setItem('karaoke-profile', JSON.stringify({
        name: $('input-name').value.trim(),
        avatar: readAvatar(),
      }));
    } catch (e) { /* bo qua */ }
    renderAvatarPreview();
  }

  function saveSettings() {
    try {
      localStorage.setItem('karaoke-settings', JSON.stringify(state.settings));
    } catch (e) { /* bo qua */ }
  }

  function renderAvatarPreview() {
    const av = readAvatar();
    const prev = $('avatar-preview');
    prev.style.background = av.shirtColor;
    prev.style.borderColor = av.hairColor;
    prev.textContent = '🎤';
    const chibi = $('chibi-2d');
    if (chibi) {
      chibi.style.setProperty('--shirt', av.shirtColor);
      const hair = chibi.querySelector('.chibi-hair');
      if (hair) hair.style.background = av.hairColor;
    }
  }

  // ---------- Cai dat ----------
  function applySettings() {
    const s = state.settings;
    $('set-subtitles').checked = s.subtitles;
    $('set-laser').checked = s.laser;
    $('set-quality').value = s.quality;
    $('set-hide-buttons').checked = s.hideButtons;
    document.body.classList.toggle('hide-buttons', s.hideButtons);
    $('laser').classList.toggle('off', !s.laser);
    $('subtitle-line').style.display = s.subtitles ? '' : 'none';
    if (s.quality === 'smooth') {
      // May yeu: dung san khau 2D cho nhe, tat laser.
      show2DStage();
      $('laser').classList.add('off');
    }
  }

  // ---------- Meta (qua, emote) ----------
  async function loadMeta() {
    const fallbackGifts = [
      { id: 'hoa', name: 'Bo hoa', icon: '🌸', cost: 10, support: 10 },
      { id: 'tim', name: 'Trai tim', icon: '💗', cost: 20, support: 20 },
      { id: 'sao', name: 'Ngoi sao', icon: '⭐', cost: 50, support: 50 },
      { id: 'vuong-mien', name: 'Vuong mien', icon: '👑', cost: 100, support: 120 },
      { id: 'phao-hoa', name: 'Phao hoa', icon: '🎆', cost: 200, support: 250 },
    ];
    try {
      const res = await fetch('/api/meta');
      const data = await res.json();
      state.gifts = data.gifts || fallbackGifts;
      state.emotes = data.emotes || ['👏', '🎤', '❤️', '🔥', '😂', '👍', '🎉', '😍'];
    } catch (e) {
      state.gifts = fallbackGifts;
      state.emotes = ['👏', '🎤', '❤️', '🔥', '😂', '👍', '🎉', '😍'];
    }
    renderGifts();
    renderEmotes();
  }

  function renderGifts() {
    const box = $('gifts');
    box.innerHTML = '';
    for (const g of state.gifts) {
      const b = document.createElement('button');
      b.className = 'gift-btn';
      b.innerHTML = `${g.icon} ${g.name}<small>${g.cost} xu • +${g.support} ung ho</small>`;
      b.addEventListener('click', () => {
        if (state.socket) state.socket.emit('send-gift', g.id);
      });
      box.appendChild(b);
    }
  }

  function renderEmotes() {
    const row = $('emote-row');
    row.innerHTML = '';
    for (const e of state.emotes) {
      const b = document.createElement('button');
      b.textContent = e;
      b.addEventListener('click', () => sendChat(e, 'emote'));
      row.appendChild(b);
    }
  }

  // ---------- Socket ----------
  function connectSocket() {
    if (typeof io === 'undefined') {
      showNotice('Khong tai duoc thu vien ket noi (Socket.IO CDN). Kiem tra mang roi tai lai trang.');
      return;
    }
    const socket = io();
    state.socket = socket;

    socket.on('connect', () => { state.socketId = socket.id; });
    socket.on('disconnect', () => showNotice('Mat ket noi toi server, dang thu ket noi lai...'));
    socket.on('connect_error', () => showNotice('Khong ket noi duoc server. Kiem tra server co dang chay khong (node server.js).'));

    socket.on('hello', (data) => {
      state.serverNow = data.serverNow || Date.now();
      state.clockOffset = state.serverNow - Date.now();
      state.livekitEnabled = data.livekitEnabled === true;
      if (!state.livekitEnabled) {
        $('voice-badge').textContent = 'Voice: chua bat (chua cau hinh LiveKit)';
        $('mic-status').textContent = 'Voice chua bat vi server chua cau hinh LiveKit. Video, chat va hang cho van chay binh thuong.';
      } else {
        $('voice-badge').textContent = 'Voice: san sang';
        $('mic-status').textContent = 'Voice san sang. Giu nut "Giu de noi" de noi chuyen.';
      }
      if (!$('input-name').value && data.suggestedName) {
        $('input-name').value = data.suggestedName;
        saveProfile();
      }
      socket.emit('list-spaces');
    });

    socket.on('spaces-list', (spaces) => renderLobby(spaces));
    socket.on('joined-space', (data) => enterSpace(data));
    socket.on('space-state', (space) => { if (state.space) updateSpace(space); });
    socket.on('player-joined', () => { /* space-state se cap nhat */ });
    socket.on('host-changed', (h) => { showNotice(`Chu phong moi: ${h.hostName}`); });

    socket.on('error-message', (msg) => showNotice(msg));
    socket.on('chat-message', (msg) => addChatLine(msg));
    socket.on('cheer', (cheer) => showCheer(cheer));
    socket.on('gift', (g) => {
      addChatLine({ userName: 'He thong', text: `${g.fromName} da tang ${g.gift.icon} ${g.gift.name} cho ca si!`, kind: 'sys' });
      if (g.newlyUnlocked && g.newlyUnlocked.length) {
        addChatLine({ userName: 'He thong', text: `Ca si vua mo khoa trang phuc moi: ${g.newlyUnlocked.join(', ')}`, kind: 'sys' });
      }
    });
    socket.on('coins-update', (d) => {
      state.me.coins = d.coins;
      $('coins-value').textContent = d.coins;
    });
    socket.on('round-score', (d) => {
      const box = $('score-box');
      box.hidden = false;
      box.textContent = `Vong ${d.roundsSoFar}: ${d.round.score} diem (sao ${d.round.stars}, do phu ${Math.round(d.round.coverage * 100)}%)`;
    });
    socket.on('score-announce', (s) => {
      const box = $('score-box');
      box.hidden = false;
      box.textContent = `🎉 ${s.singerName} dat ${s.finalScore}/5 diem — thuong ${s.coins} xu!`;
    });
    // Bao ro ly do qua video: du phieu skip hay chu phong qua bai.
    socket.on('skip-announce', (s) => {
      let text;
      if (s.reason === 'voted-skip') {
        text = `Da du phieu skip (${s.votes}/${s.needed}) — qua video tiep theo${s.title ? `: ${s.title}` : ''}.`;
      } else {
        text = `${s.byName || 'Chu phong'} (chu phong) da qua bai${s.title ? `: ${s.title}` : ''}.`;
      }
      addChatLine({ userName: 'He thong', text, kind: 'sys' });
      showNotice(text);
    });
    socket.on('playback-status', (p) => {
      if (p.status === 'waiting-ad') $('ad-waiting').hidden = false;
      else $('ad-waiting').hidden = true;
    });
  }

  // ---------- Sanh: 2 lua chon ----------
  function renderLobby(spaces) {
    const grid = $('spaces-grid');
    grid.innerHTML = '';
    for (const space of spaces) {
      const card = document.createElement('button');
      card.className = 'room-card';
      const players = space.players ? space.players.length : 0;
      const tag = space.mode === 'karaoke' ? '🎤 Hat chung' : '🎬 Xem phim chung';
      card.innerHTML = `<h3>${tag} — ${space.name}</h3><p>${space.desc}</p><p>${space.totalSeats} ghe • ${players} dang xem</p>`;
      card.addEventListener('click', () => joinSpace(space.id));
      grid.appendChild(card);
    }
  }

  function joinSpace(spaceId) {
    if (!state.socket) return;
    saveProfile();
    const name = $('input-name').value.trim();
    state.socket.emit('join-space', {
      spaceId,
      name,
      avatar: readAvatar(),
      isGuest: !name,
    });
  }

  // ---------- Vao khong gian ----------
  function enterSpace(data) {
    state.space = data.space;
    state.me = { ...state.me, ...data.you };
    state.currentVideoId = null;
    document.body.classList.remove('mode-karaoke', 'mode-cinema');
    document.body.classList.add(data.space.mode === 'cinema' ? 'mode-cinema' : 'mode-karaoke');
    $('lobby-view').hidden = true;
    $('space-view').hidden = false;
    $('guest-banner').hidden = !data.you.isGuest;
    $('me-badge').textContent = data.you.isGuest ? 'Dang xem truoc' : data.you.name;
    $('coins-value').textContent = data.you.coins;
    updateSpace(data.space);
    if (data.space.mode === 'cinema') {
      // Rap phim khong co san khau 3D ca si, dung san khau 2D.
      show2DStage();
    } else {
      initStage();
    }
    connectLiveKit();
    window.scrollTo(0, 0);
  }

  function updateSpace(space) {
    state.space = space;
    state.serverNow = space.serverNow || Date.now();
    state.clockOffset = state.serverNow - Date.now();
    $('space-name').textContent = space.name;
    $('space-online').textContent = `${space.players.length} dang xem`;
    if (space.mode === 'karaoke') {
      const hostPlayer = space.players[0];
      $('space-host').textContent = `Chu phong: ${hostPlayer ? hostPlayer.name : '-'}`;
      renderQueue($('queue-list'), space.queue, 'queue');
      renderLeaderboard(space);
      renderSupport(space);
    } else {
      renderQueue($('queue-list-cinema'), space.queue, 'cinema');
    }
    renderSeats(space);
    $('skip-count').textContent = `${space.skipVotes || 0}/${space.skipNeeded || 0} phieu`;
    const pb = space.playback || {};
    $('np-title').textContent = pb.title || 'Chua co gi';
    $('np-singer').textContent = pb.singerName ? `— ${pb.singerName} dang hat` : '';
    $('singer-name-2d').textContent = pb.singerName ? `${pb.singerName} dang hat` : 'Chua co ai hat';
    $('subtitle-line').textContent = pb.title ? `♪ ${pb.title} ♪` : '';
    syncPlayback(pb);
  }

  function renderSeats(space) {
    const box = $('seats');
    box.innerHTML = '';
    const mySeat = space.players.find((p) => p.id === state.socketId);
    const mySeatId = mySeat ? mySeat.seatId : null;
    for (const seat of space.seats) {
      const b = document.createElement('button');
      const typeLabel = seat.type === 'single' ? 'Ghe don' : seat.type === 'double' ? 'Ghe doi' : 'Ghe ba';
      b.className = `seat ${seat.type}`;
      if (seat.id === mySeatId) b.classList.add('mine');
      if (seat.occupants.length >= seat.capacity) b.classList.add('full');
      const names = seat.occupants.map((o) => o.name).join(', ') || 'Trong';
      b.innerHTML = `${typeLabel} ${seat.id.replace(/^(single|double|triple)-/, '')}<small>${names}</small>`;
      b.addEventListener('click', () => {
        if (state.socket) state.socket.emit('select-seat', seat.id);
      });
      box.appendChild(b);
    }
  }

  // Hang cho video dung chung ca 2 khong gian (ten nguoi de xuat hien ro).
  // kind = 'queue' (karaoke) hoac 'cinema' (rap phim).
  function renderQueue(listEl, queue, kind) {
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!queue || queue.length === 0) {
      listEl.innerHTML = '<li>Hang cho dang trong. Tim video hoac dan link de de xuat.</li>';
      return;
    }
    const addEvt = kind === 'cinema' ? 'cinema-vote' : 'queue-vote';
    const removeEvt = kind === 'cinema' ? 'cinema-remove' : 'queue-remove';
    for (const song of queue) {
      const li = document.createElement('li');
      const mine = song.addedBy === state.socketId;
      li.innerHTML = `<span class="q-title">${song.title}</span><span class="q-meta">de xuat boi ${song.addedByName} • ${song.votes} vote</span>`;
      const voteBtn = document.createElement('button');
      voteBtn.className = 'btn small ghost';
      voteBtn.textContent = '👍 Vote';
      voteBtn.addEventListener('click', () => state.socket.emit(addEvt, song.id));
      li.appendChild(voteBtn);
      if (mine || (kind === 'queue' && state.me.isHost)) {
        const rm = document.createElement('button');
        rm.className = 'btn small ghost';
        rm.textContent = 'Xoa';
        rm.addEventListener('click', () => state.socket.emit(removeEvt, song.id));
        li.appendChild(rm);
      }
      listEl.appendChild(li);
    }
  }

  function renderLeaderboard(space) {
    const ol = $('leaderboard');
    ol.innerHTML = '';
    const rows = [...(space.leaderboard || [])].sort((a, b) => b.totalScore - a.totalScore);
    if (rows.length === 0) {
      ol.innerHTML = '<li>Chua co ai hat xong bai nao.</li>';
      return;
    }
    for (const r of rows) {
      const li = document.createElement('li');
      li.textContent = `${r.name} — ${r.totalScore} diem (${r.songsSung} bai, ${r.coins} xu)`;
      ol.appendChild(li);
    }
  }

  function renderSupport(space) {
    const singerId = space.playback && space.playback.singerId;
    const pts = singerId && space.support ? (space.support[singerId] || 0) : 0;
    $('support-info').textContent = singerId
      ? `Ca si dang hat co ${pts} diem ung ho. Du 100 diem mo Ao do, 300 diem mo Ao vang.`
      : 'Chua co ai hat de tang qua.';
  }

  // ---------- Chat ----------
  function addChatLine(msg) {
    const log = $('chat-log');
    const div = document.createElement('div');
    if (msg.kind === 'sys') {
      div.className = 'sys';
      div.textContent = msg.text;
    } else {
      div.textContent = `${msg.userName}: ${msg.text}`;
    }
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  function sendChat(text, kind) {
    if (!state.socket) return;
    if (!text.trim()) return;
    state.socket.emit('chat-message', { text, kind: kind || 'text' });
    if (kind !== 'emote') $('input-chat').value = '';
  }

  let cheerTimer = null;
  function showCheer(cheer) {
    const ov = $('cheer-overlay');
    ov.textContent = `“${cheer.text}” — ${cheer.userName}`;
    clearTimeout(cheerTimer);
    cheerTimer = setTimeout(() => { ov.textContent = ''; }, 5000);
    addChatLine({ userName: cheer.userName, text: `📣 ${cheer.text}`, kind: 'text' });
  }

  // ---------- YouTube ----------
  function serverPositionSeconds(playback) {
    if (!playback || !playback.startedAt) return 0;
    const now = Date.now() + state.clockOffset;
    const sec = (now - playback.startedAt) / 1000;
    return sec > 0 ? sec : 0;
  }

  function syncPlayback(playback) {
    if (!playback || !playback.videoId) {
      state.currentVideoId = null;
      return;
    }
    if (state.ytFailed) return;
    if (typeof YT === 'undefined' || !YT.Player) return; // cho API tai xong
    if (!state.ytPlayer) {
      createPlayer(playback);
      return;
    }
    if (state.currentVideoId !== playback.videoId) {
      state.currentVideoId = playback.videoId;
      const pos = serverPositionSeconds(playback);
      state.ytPlayer.loadVideoById({ videoId: playback.videoId, startSeconds: pos });
      return;
    }
    if (playback.status === 'paused') {
      try { state.ytPlayer.pauseVideo(); } catch (e) { /* bo qua */ }
    }
  }

  function createPlayer(playback) {
    try {
      state.ytPlayer = new YT.Player('yt-player', {
        height: '100%',
        width: '100%',
        videoId: playback.videoId,
        playerVars: { autoplay: 1, playsinline: 1 },
        events: {
          onReady: (e) => {
            state.ytReady = true;
            const pos = serverPositionSeconds(playback);
            if (pos > 0) e.target.seekTo(pos, true);
            e.target.playVideo();
          },
          onStateChange: (e) => {
            const S = YT.PlayerState;
            if (!state.socket) return;
            if (e.data === S.ENDED) state.socket.emit('player-state', { state: 'ended' });
            if (e.data === S.PLAYING) {
              $('ad-waiting').hidden = true;
              state.socket.emit('player-state', { state: 'playing' });
            }
            if (e.data === S.PAUSED) state.socket.emit('player-state', { state: 'paused' });
            if (e.data === S.BUFFERING) {
              $('ad-waiting').hidden = false;
              state.socket.emit('player-state', { state: 'buffering' });
            }
          },
          onError: () => {
            $('yt-fallback').hidden = false;
            $('ad-waiting').hidden = true;
          },
        },
      });
      state.currentVideoId = playback.videoId;
    } catch (e) {
      state.ytFailed = true;
      $('yt-fallback').hidden = false;
    }
  }

  window.onYouTubeIframeAPIReady = function () {
    if (state.space && state.space.playback && state.space.playback.videoId) {
      syncPlayback(state.space.playback);
    }
  };
  // Neu API tai qua lau thi bao loi than thien.
  setTimeout(() => {
    if (typeof YT === 'undefined' && state.space) {
      state.ytFailed = true;
      $('yt-fallback').hidden = false;
    }
  }, 10000);

  // Kiem tra lech dong bo moi 5 giay cho MOI may (ca karaoke lan rap phim).
  setInterval(() => {
    if (!state.ytPlayer || !state.ytReady || !state.space) return;
    const pb = state.space.playback;
    if (!pb || !pb.videoId || pb.status !== 'playing') return;
    try {
      const cur = state.ytPlayer.getCurrentTime();
      const serverPos = serverPositionSeconds(pb);
      if (Math.abs(cur - serverPos) > SYNC_THRESHOLD) state.ytPlayer.seekTo(serverPos, true);
    } catch (e) { /* bo qua */ }
  }, 5000);

  // ---------- San khau 3D / 2D (chi phong karaoke) ----------
  function initStage() {
    if (state.settings.quality === 'smooth') { show2DStage(); return; }
    if (typeof THREE === 'undefined') {
      show2DStage();
      showNotice('Khong tai duoc Three.js tu CDN nen phong dang dung san khau 2D. Ban van hat, chat va xem video binh thuong.');
      return;
    }
    try {
      buildThreeStage();
      const wrap = $('stage-wrap');
      wrap.classList.remove('mode-2d');
      wrap.classList.add('mode-3d');
      $('stage-2d').hidden = true;
      $('stage-3d').hidden = false;
    } catch (e) {
      show2DStage();
    }
  }

  function show2DStage() {
    const wrap = $('stage-wrap');
    wrap.classList.remove('mode-3d');
    wrap.classList.add('mode-2d');
    $('stage-3d').hidden = true;
    $('stage-2d').hidden = false;
    if (state.three) {
      cancelAnimationFrame(state.three.raf);
      state.three = null;
    }
  }

  function buildThreeStage() {
    const wrap = $('stage-3d');
    wrap.innerHTML = '';
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x12081f);
    const camera = new THREE.PerspectiveCamera(55, wrap.clientWidth / Math.max(1, wrap.clientHeight), 0.1, 100);
    camera.position.set(0, 5, 12);
    camera.lookAt(0, 1.5, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    wrap.appendChild(renderer.domElement);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 20),
      new THREE.MeshStandardMaterial({ color: 0x2a0a4a })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 5),
      new THREE.MeshBasicMaterial({ color: 0x111122 })
    );
    screen.position.set(0, 3.2, -6);
    scene.add(screen);

    const singer = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.7, 1.6, 16),
      new THREE.MeshStandardMaterial({ color: 0xff2e88 })
    );
    body.position.y = 0.8;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xf6d7b0 })
    );
    head.position.y = 2.0;
    const mouth = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x7f1d1d })
    );
    mouth.position.set(0, 1.88, 0.42);
    mouth.scale.set(1, 0.4, 0.5);
    singer.add(body, head, mouth);
    singer.position.set(0, 0, -2);
    scene.add(singer);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const spot1 = new THREE.SpotLight(0xff2e88, 2, 30, 0.6, 0.5);
    spot1.position.set(-5, 8, 4);
    scene.add(spot1);
    const spot2 = new THREE.SpotLight(0x22d3ee, 2, 30, 0.6, 0.5);
    spot2.position.set(5, 8, 4);
    scene.add(spot2);

    const views = {
      wide: { pos: [0, 5, 12], look: [0, 1.5, 0] },
      seat: { pos: [0, 2, 8], look: [0, 2.5, -6] },
      screen: { pos: [0, 3, 2], look: [0, 3.2, -6] },
      stage: { pos: [0, 3, -4], look: [0, 2, 10] },
    };
    let currentView = 'wide';
    const clock = new THREE.Clock();
    let raf = 0;
    function animate() {
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      singer.position.y = Math.sin(t * 2) * 0.08;
      mouth.scale.y = 0.4 + state.micLevel * 2;
      if (state.settings.laser) {
        spot1.position.x = Math.sin(t) * 6;
        spot2.position.x = Math.cos(t) * 6;
      }
      const v = views[currentView];
      camera.position.set(v.pos[0], v.pos[1], v.pos[2]);
      camera.lookAt(v.look[0], v.look[1], v.look[2]);
      renderer.render(scene, camera);
    }
    animate();
    state.three = {
      raf,
      setView: (name) => { if (views[name]) currentView = name; },
    };
  }

  // ---------- LiveKit mic ----------
  async function connectLiveKit() {
    $('btn-ptt').disabled = true;
    if (!state.livekitEnabled || typeof LivekitClient === 'undefined') {
      if (state.livekitEnabled && typeof LivekitClient === 'undefined') {
        $('mic-status').textContent = 'Khong tai duoc thu vien LiveKit tu CDN. Voice tam tat, phong van chay.';
      }
      return;
    }
    try {
      const res = await fetch('/api/livekit-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: state.socketId, name: state.me.name, room: state.space.id }),
      });
      const data = await res.json();
      if (!data.enabled) {
        $('mic-status').textContent = data.reason || 'Voice chua bat.';
        return;
      }
      const room = new LivekitClient.Room({
        adaptiveStream: true,
        dynacast: true,
      });
      await room.connect(data.url, data.token);
      state.livekitRoom = room;
      room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === LivekitClient.Track.Kind.Audio) {
          const el = track.attach();
          el.muted = !state.headphoneMode;
          el.dataset.participant = participant.identity;
          document.body.appendChild(el);
        }
      });
      room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => el.remove());
      });
      $('mic-status').textContent = state.space.mode === 'cinema'
        ? 'Da vao kenh voice rap phim. Mic mo cho moi nguoi — giu nut "Giu de noi" de noi chuyen.'
        : 'Da vao kenh voice. Giu nut "Giu de noi" de noi.';
      $('btn-ptt').disabled = false;
      await listMicDevices();
    } catch (e) {
      $('mic-status').textContent = `Khong vao duoc kenh voice: ${e.message}. Phong van chay, chi mic bi tat.`;
    }
  }

  async function listMicDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const sel = $('select-mic-device');
      sel.innerHTML = '<option value="">Mac dinh</option>';
      for (const d of devices.filter((x) => x.kind === 'audioinput')) {
        const o = document.createElement('option');
        o.value = d.deviceId;
        o.textContent = d.label || 'Mic';
        sel.appendChild(o);
      }
    } catch (e) { /* bo qua */ }
  }

  async function startMic() {
    if (!state.livekitRoom) return;
    try {
      const deviceId = $('select-mic-device').value || undefined;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId
          ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      state.micAnalyser = analyser;
      const track = await state.livekitRoom.localParticipant.publishTrack(
        new LivekitClient.LocalAudioTrack(stream.getAudioTracks()[0]),
        { source: LivekitClient.Track.Source.Microphone }
      );
      state.micTrack = track;
      track.mute();
      micLoop();
    } catch (e) {
      $('mic-status').textContent = `Khong mo duoc mic: ${e.message}. Kiem tra quyen mic cua trinh duyet.`;
    }
  }

  function micLoop() {
    if (!state.micAnalyser) return;
    const data = new Uint8Array(state.micAnalyser.frequencyBinCount);
    const tick = () => {
      if (!state.micAnalyser) return;
      state.micAnalyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) sum += data[i];
      const level = sum / data.length / 255;
      state.micLevel = level;
      $('mic-level-bar').style.width = `${Math.round(level * 100)}%`;
      const chibi = $('chibi-2d');
      if (chibi) chibi.style.setProperty('--mouth', level.toFixed(2));
      requestAnimationFrame(tick);
    };
    tick();
    // Gui mau mic cho server cham diem (chi khi minh dang hat karaoke).
    setInterval(() => {
      if (!state.socket || !state.space) return;
      if (state.space.mode !== 'karaoke') return;
      if (state.space.playback && state.space.playback.singerId === state.socketId) {
        state.socket.emit('mic-sample', { active: state.micLevel > 0.08 });
      }
    }, 500);
  }

  function setPtt(held) {
    state.pttHeld = held;
    if (!state.micTrack) {
      if (held) startMic();
      return;
    }
    if (held) state.micTrack.unmute();
    else state.micTrack.mute();
  }

  // ---------- Tim video (dung chung ca 2 khong gian) ----------
  async function searchVideos(inputEl, resultsEl, addEvent) {
    const q = inputEl.value.trim();
    if (!q) return;
    resultsEl.innerHTML = '<div class="hint">Dang tim...</div>';
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!data.ok) {
        resultsEl.innerHTML = `<div class="hint">${data.error}</div>`;
        return;
      }
      resultsEl.innerHTML = '';
      for (const r of data.results) {
        const item = document.createElement('div');
        item.className = 'search-item';
        item.innerHTML = `<span>${r.title} — ${r.channel}</span>`;
        const b = document.createElement('button');
        b.className = 'btn small';
        b.textContent = '＋ De xuat';
        b.addEventListener('click', () => {
          state.socket.emit(addEvent, { videoId: r.videoId, title: r.title, channel: r.channel });
        });
        item.appendChild(b);
        resultsEl.appendChild(item);
      }
      if (data.results.length === 0) resultsEl.innerHTML = '<div class="hint">Khong tim thay video nao.</div>';
    } catch (e) {
      resultsEl.innerHTML = '<div class="hint">Khong tim duoc video. Kiem tra server co chay khong.</div>';
    }
  }

  // ---------- Su kien giao dien ----------
  function bindUI() {
    $('btn-random-name').addEventListener('click', () => {
      const names = ['Ca Si Tre', 'Giong Hat Vang', 'Sao Mai', 'Hat Hay', 'Sao Dem', 'Hat Vui'];
      $('input-name').value = `${names[Math.floor(Math.random() * names.length)]} ${Math.floor(100 + Math.random() * 900)}`;
      saveProfile();
    });
    ['input-name', 'select-hair', 'input-hair-color', 'select-skin', 'input-shirt-color', 'select-accessory']
      .forEach((id) => $(id).addEventListener('change', saveProfile));

    $('btn-leave-space').addEventListener('click', async () => {
      if (state.livekitRoom) {
        try { await state.livekitRoom.disconnect(); } catch (e) { /* bo qua */ }
        state.livekitRoom = null;
      }
      if (state.ytPlayer) { try { state.ytPlayer.stopVideo(); } catch (e) { /* bo qua */ } }
      if (state.socket) state.socket.emit('leave-space');
      state.space = null;
      state.currentVideoId = null;
      document.body.classList.remove('mode-karaoke', 'mode-cinema');
      $('space-view').hidden = true;
      $('lobby-view').hidden = false;
      if (state.socket) state.socket.emit('list-spaces');
    });
    $('btn-set-name').addEventListener('click', () => {
      showNotice('Hay quay ve sanh dat ten roi vao lai khong gian de hat va chat.');
      $('space-view').hidden = true;
      $('lobby-view').hidden = false;
      $('input-name').focus();
    });

    // Karaoke: tim bai + dan link de xuat vao hang cho.
    $('btn-search').addEventListener('click', () => searchVideos($('input-search'), $('search-results'), 'queue-add'));
    $('input-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchVideos($('input-search'), $('search-results'), 'queue-add'); });
    $('btn-add-link').addEventListener('click', () => {
      const link = $('input-link').value.trim();
      if (!link || !state.socket) return;
      state.socket.emit('queue-add', { videoId: link, title: '', channel: '' });
      $('input-link').value = '';
    });

    // Rap phim: tim video + dan link de xuat vao hang cho.
    $('btn-search-cinema').addEventListener('click', () => searchVideos($('input-search-cinema'), $('search-results-cinema'), 'cinema-add'));
    $('input-search-cinema').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchVideos($('input-search-cinema'), $('search-results-cinema'), 'cinema-add'); });
    $('btn-add-link-cinema').addEventListener('click', () => {
      const link = $('input-link-cinema').value.trim();
      if (!link || !state.socket) return;
      state.socket.emit('cinema-add', { videoId: link, title: '', channel: '' });
      $('input-link-cinema').value = '';
    });
    $('btn-play-next-cinema').addEventListener('click', () => state.socket && state.socket.emit('cinema-play-next'));
    $('btn-stop-cinema').addEventListener('click', () => state.socket && state.socket.emit('cinema-stop'));

    // Karaoke: dieu khien bai hat.
    $('btn-play-next').addEventListener('click', () => state.socket && state.socket.emit('play-next'));
    $('btn-skip-song').addEventListener('click', () => state.socket && state.socket.emit('skip-song'));
    $('btn-stop-song').addEventListener('click', () => state.socket && state.socket.emit('stop-song'));

    // Bo phieu skip — dung chung ca 2 khong gian.
    $('btn-vote-skip').addEventListener('click', () => state.socket && state.socket.emit('vote-skip'));

    document.querySelectorAll('.star-btn').forEach((b) => {
      b.addEventListener('click', () => {
        if (state.socket) state.socket.emit('vote-stars', Number(b.dataset.stars));
        document.querySelectorAll('.star-btn').forEach((x) => x.classList.remove('voted'));
        b.classList.add('voted');
      });
    });

    $('btn-send-chat').addEventListener('click', () => sendChat($('input-chat').value, 'text'));
    $('input-chat').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat($('input-chat').value, 'text'); });
    $('btn-cheer').addEventListener('click', () => {
      const text = $('input-cheer').value.trim();
      if (!text || !state.socket) return;
      state.socket.emit('cheer', { text });
      $('input-cheer').value = '';
    });

    $('btn-ptt').addEventListener('pointerdown', (e) => { e.preventDefault(); setPtt(true); });
    $('btn-ptt').addEventListener('pointerup', () => setPtt(false));
    $('btn-ptt').addEventListener('pointerleave', () => setPtt(false));
    $('check-headphone').addEventListener('change', (e) => {
      state.headphoneMode = e.target.checked;
      document.querySelectorAll('audio[data-participant]').forEach((el) => { el.muted = !state.headphoneMode; });
    });

    document.querySelectorAll('.cam-btn').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.cam-btn').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        const wrap = $('stage-wrap');
        wrap.classList.remove('cam-wide', 'cam-seat', 'cam-screen', 'cam-stage');
        wrap.classList.add(`cam-${b.dataset.cam}`);
        if (state.three) state.three.setView(b.dataset.cam);
      });
    });

    $('btn-settings').addEventListener('click', () => { $('settings-modal').hidden = false; });
    $('btn-close-settings').addEventListener('click', () => { $('settings-modal').hidden = true; });
    $('set-subtitles').addEventListener('change', (e) => { state.settings.subtitles = e.target.checked; saveSettings(); applySettings(); });
    $('set-laser').addEventListener('change', (e) => { state.settings.laser = e.target.checked; saveSettings(); applySettings(); });
    $('set-quality').addEventListener('change', (e) => { state.settings.quality = e.target.value; saveSettings(); applySettings(); });
    $('set-hide-buttons').addEventListener('change', (e) => { state.settings.hideButtons = e.target.checked; saveSettings(); applySettings(); });
  }

  // ---------- Khoi dong ----------
  loadProfile();
  renderAvatarPreview();
  bindUI();
  applySettings();
  loadMeta();
  connectSocket();
})();
