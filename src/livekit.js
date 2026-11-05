// Cap token LiveKit cho mic/voice.
// Key/secret/URL chi doc tu bien moi truong, khong hardcode.
// Neu chua cau hinh du ca 3 thi tra ve { enabled: false } de client
// tu tat mic mot cach tu te (bao "Voice chua bat") nhung phong van chay.
// livekit-server-sdk chi duoc require ben trong ham, de cac test khong
// can cai dependency van chay duoc.

function livekitConfig(env = process.env) {
  return {
    url: (env.LIVEKIT_URL || '').trim(),
    apiKey: (env.LIVEKIT_API_KEY || '').trim(),
    apiSecret: (env.LIVEKIT_API_SECRET || '').trim(),
    turnUrl: (env.TURN_URL || '').trim(),
    turnUser: (env.TURN_USER || '').trim(),
    turnPass: (env.TURN_PASS || '').trim(),
  };
}

function isConfigured(cfg) {
  return Boolean(cfg.url && cfg.apiKey && cfg.apiSecret);
}

// Cap token vao 1 phong LiveKit. identity la id socket, name la ten hien thi.
async function createToken({ identity, name, roomName, env = process.env }) {
  const cfg = livekitConfig(env);
  if (!isConfigured(cfg)) {
    return { enabled: false, reason: 'Chua cau hinh LiveKit (LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET). Voice dang tat.' };
  }
  const { AccessToken } = require('livekit-server-sdk');
  const token = new AccessToken(cfg.apiKey, cfg.apiSecret, {
    identity: String(identity),
    name: String(name || identity),
    ttl: 60 * 60 * 6,
  });
  token.addGrant({
    room: String(roomName),
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  const jwt = await token.toJwt();
  return {
    enabled: true,
    url: cfg.url,
    token: jwt,
    turn: cfg.turnUrl
      ? { url: cfg.turnUrl, username: cfg.turnUser, credential: cfg.turnPass }
      : null,
  };
}

module.exports = { livekitConfig, isConfigured, createToken };
