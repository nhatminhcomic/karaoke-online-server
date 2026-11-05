// Chat, emote, tang qua, loi co vu trong phong.
// Server giu so lieu that: diem ung ho cua tung ca si, trang phuc mo khoa.
// Qua tang KHONG doi ra tien, chi doi diem ung ho va mo khoa trang phuc.

const MAX_CHAT_LEN = 300;
const MAX_CHEER_LEN = 80;

// Danh muc qua tang: gia bang xu ao trong game, diem ung ho tuong ung.
const GIFTS = [
  { id: 'hoa', name: 'Bo hoa', icon: '🌸', cost: 10, support: 10 },
  { id: 'tim', name: 'Trai tim', icon: '💗', cost: 20, support: 20 },
  { id: 'sao', name: 'Ngoi sao', icon: '⭐', cost: 50, support: 50 },
  { id: 'vuong-mien', name: 'Vuong mien', icon: '👑', cost: 100, support: 120 },
  { id: 'phao-hoa', name: 'Phao hoa', icon: '🎆', cost: 200, support: 250 },
];

// Trang phuc mo khoa theo tong diem ung ho cua ca si.
const OUTFITS = [
  { id: 'ao-den', name: 'Ao den co ban', supportNeeded: 0 },
  { id: 'ao-do', name: 'Ao do san khau', supportNeeded: 100 },
  { id: 'ao-vang', name: 'Ao vang ngoi sao', supportNeeded: 300 },
  { id: 'ao-bac', name: 'Ao bac hoang tu', supportNeeded: 800 },
  { id: 'ao-kim-cuong', name: 'Ao kim cuong', supportNeeded: 2000 },
];

// Emote duoc phep dung trong chat (chi icon nay, khong tu do chen anh).
const EMOTES = ['👏', '🎤', '❤️', '🔥', '😂', '👍', '🎉', '😍'];

function sanitizeText(text, maxLen) {
  return String(text || '')
    .replace(/[<>&"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function makeChatMessage({ userId, userName, avatar, text, kind = 'text' }) {
  const clean = sanitizeText(text, MAX_CHAT_LEN);
  if (!clean) return null;
  return {
    id: `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    userId,
    userName,
    avatar: avatar || null,
    text: clean,
    kind,
    at: Date.now(),
  };
}

function makeCheer({ userId, userName, text }) {
  const clean = sanitizeText(text, MAX_CHEER_LEN);
  if (!clean) return null;
  return {
    id: `cheer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    userId,
    userName,
    text: clean,
    at: Date.now(),
  };
}

// Trang phuc da mo khoa voi tong diem ung ho hien tai.
function unlockedOutfits(totalSupport) {
  return OUTFITS.filter((o) => totalSupport >= o.supportNeeded).map((o) => o.id);
}

// Tang qua cho ca si dang hat. Server tru xu nguoi tang, cong diem ung ho.
// Tra ve { ok, gift, singerSupport, unlocked } hoac { ok: false, reason }.
function sendGift({ gifts, giftId, fromUser, singerId, singerSupportMap }) {
  const gift = GIFTS.find((g) => g.id === giftId);
  if (!gift) return { ok: false, reason: 'Qua khong ton tai.' };
  if (!singerId) return { ok: false, reason: 'Dang khong co ai hat de tang qua.' };
  if (fromUser.id === singerId) return { ok: false, reason: 'Khong tu tang qua cho chinh minh.' };
  if ((fromUser.coins || 0) < gift.cost) {
    return { ok: false, reason: 'Khong du xu de tang qua nay.' };
  }
  fromUser.coins -= gift.cost;
  const before = singerSupportMap.get(singerId) || 0;
  const after = before + gift.support;
  singerSupportMap.set(singerId, after);
  const unlocked = unlockedOutfits(after);
  const newlyUnlocked = unlocked.filter((id) => !unlockedOutfits(before).includes(id));
  return { ok: true, gift, singerSupport: after, unlocked, newlyUnlocked };
}

module.exports = {
  GIFTS,
  OUTFITS,
  EMOTES,
  MAX_CHAT_LEN,
  MAX_CHEER_LEN,
  sanitizeText,
  makeChatMessage,
  makeCheer,
  unlockedOutfits,
  sendGift,
};
