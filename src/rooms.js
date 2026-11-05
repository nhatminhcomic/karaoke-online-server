// Quan ly 2 khong gian duy nhat cua he thong:
// - 'karaoke': 1 phong karaoke duy nhat, moi nguoi cung vao hat chung.
// - 'cinema': rap ngoai troi xem phim chung (khong hat karaoke).
// Ghe co 3 loai: single (1 cho), double (2 cho), triple (3 cho).
// Ghe nao ai ngoi thi ca khong gian deu thay.

function buildSeats({ single = 0, double = 0, triple = 0 }) {
  const seats = [];
  const add = (type, count, capacity) => {
    for (let i = 0; i < count; i += 1) {
      seats.push({
        id: `${type}-${i + 1}`,
        type,
        capacity,
        occupants: [],
      });
    }
  };
  add('single', single, 1);
  add('double', double, 2);
  add('triple', triple, 3);
  return seats;
}

function totalCapacity(seats) {
  return seats.reduce((sum, seat) => sum + seat.capacity, 0);
}

// Chi co 2 khong gian co dinh, khong them phong nao khac.
function baseSpaceDefinitions() {
  return [
    {
      id: 'karaoke',
      name: 'Phong Karaoke',
      mode: 'karaoke',
      desc: '1 phong duy nhat — moi nguoi cung vao hat chung, hang cho, cham diem',
      seats: buildSeats({ single: 18, double: 12, triple: 6 }),
    },
    {
      id: 'cinema',
      name: 'Rap Ngoai Troi',
      mode: 'cinema',
      desc: 'Xem phim chung ngoai troi, mic mo noi chuyen — khong hat karaoke',
      seats: buildSeats({ single: 24, double: 12, triple: 8 }),
    },
  ];
}

// Trang thai runtime cua 1 khong gian (server la nguon su that).
function createSpaceState(def) {
  return {
    id: def.id,
    name: def.name,
    mode: def.mode,
    desc: def.desc,
    seats: def.seats.map((s) => ({ ...s, occupants: [] })),
    players: new Map(), // socketId -> { id, name, avatar, isGuest, seatId }
    playback: {
      videoId: null,
      title: null,
      singerId: null,
      singerName: null,
      startedAt: null,
      status: 'idle', // idle | playing | paused | waiting-ad
    },
    createdAt: Date.now(),
  };
}

class SpaceManager {
  constructor() {
    this.spaces = new Map();
    for (const def of baseSpaceDefinitions()) {
      this.spaces.set(def.id, createSpaceState(def));
    }
  }

  listSpaces() {
    return [...this.spaces.values()].map((space) => this.publicView(space));
  }

  getSpace(spaceId) {
    return this.spaces.get(spaceId) || null;
  }

  addPlayer(space, player) {
    space.players.set(player.id, player);
    return player;
  }

  removePlayer(space, socketId) {
    this.releaseSeat(space, socketId);
    space.players.delete(socketId);
  }

  // Nguoi choi chon ghe. Ghe doi/ba cho nhieu nguoi ngoi chung toi da suc chua.
  // Tra ve { ok: true, seat } hoac { ok: false, reason }.
  assignSeat(space, socketId, seatId) {
    const player = space.players.get(socketId);
    if (!player) return { ok: false, reason: 'Ban chua vao khong gian.' };
    const seat = space.seats.find((s) => s.id === seatId);
    if (!seat) return { ok: false, reason: 'Ghe khong ton tai.' };
    if (seat.occupants.includes(socketId)) return { ok: true, seat };
    if (seat.occupants.length >= seat.capacity) {
      return { ok: false, reason: 'Ghe nay da day.' };
    }
    this.releaseSeat(space, socketId);
    seat.occupants.push(socketId);
    player.seatId = seat.id;
    return { ok: true, seat };
  }

  releaseSeat(space, socketId) {
    const player = space.players.get(socketId);
    if (player) player.seatId = null;
    for (const seat of space.seats) {
      const i = seat.occupants.indexOf(socketId);
      if (i !== -1) seat.occupants.splice(i, 1);
    }
  }

  // Dang cap nhat view gui cho client: ai ngoi ghe nao, ai dang trong khong gian.
  publicView(space) {
    const players = [...space.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      isGuest: p.isGuest,
      seatId: p.seatId || null,
    }));
    const seats = space.seats.map((s) => ({
      id: s.id,
      type: s.type,
      capacity: s.capacity,
      occupants: s.occupants.map((sid) => {
        const p = space.players.get(sid);
        return p ? { id: p.id, name: p.name, avatar: p.avatar } : { id: sid, name: 'Khach', avatar: null };
      }),
    }));
    return {
      id: space.id,
      name: space.name,
      mode: space.mode,
      desc: space.desc,
      totalSeats: totalCapacity(space.seats),
      players,
      seats,
      playback: { ...space.playback },
    };
  }
}

module.exports = {
  SpaceManager,
  buildSeats,
  totalCapacity,
};
