// Dong bo vi tri phat video giua cac may.
// Server luu startedAt (gio server). Client nhan kem serverNow de bu
// lech dong ho giua cac may, roi tu tinh vi tri hien tai.
// Nguong lech cho phep: 1,5 giay (theo yeu cau dong bo).

const SYNC_THRESHOLD_SECONDS = 1.5;

// Vi tri phat hien tai (giay). Tra ve 0 neu chua bat dau.
function computePositionSeconds(startedAt, clientNowMs, serverNowMs) {
  if (!startedAt) return 0;
  const clockOffset = Number(serverNowMs || 0) - Number(clientNowMs || 0);
  const serverNow = Number(clientNowMs || 0) + clockOffset;
  const seconds = (serverNow - Number(startedAt)) / 1000;
  return seconds > 0 ? seconds : 0;
}

// Co can seek lai khong? true neu lech qua 1,5 giay.
function needsResync(clientCurrentTime, serverPositionSeconds) {
  return Math.abs(Number(clientCurrentTime) - Number(serverPositionSeconds)) > SYNC_THRESHOLD_SECONDS;
}

module.exports = { SYNC_THRESHOLD_SECONDS, computePositionSeconds, needsResync };
