// Tim kiem YouTube bang YouTube Data API v3 (chay o phia server).
// Server tu them hau to "karaoke" vao tu khoa, key chi doc tu bien moi truong.
// Khong co key thi ham search se nem loi ro rang; client van dan link
// YouTube truc tiep de them bai duoc.

const API_BASE = 'https://www.googleapis.com/youtube/v3/search';

function isConfigured(apiKey) {
  return typeof apiKey === 'string' && apiKey.trim().length > 0;
}

function buildSearchQuery(keyword) {
  const clean = String(keyword || '').trim().replace(/\s+/g, ' ');
  return `${clean} karaoke`.trim();
}

// Tach videoId tu link YouTube: watch, youtu.be, shorts, embed, live.
function extractVideoId(input) {
  if (!input || typeof input !== 'string') return null;
  const text = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /shorts\/([A-Za-z0-9_-]{11})/,
    /embed\/([A-Za-z0-9_-]{11})/,
    /\/live\/([A-Za-z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}

// Tim bai hat. fetchFn duoc truyen vao de test khong can mang that.
async function searchYouTube(apiKey, keyword, maxResults = 8, fetchFn = fetch) {
  if (!isConfigured(apiKey)) {
    throw new Error('Chua cau hinh YOUTUBE_API_KEY trong file .env nen khong tim duoc bai. Hay dan link YouTube truc tiep de them bai.');
  }
  const q = buildSearchQuery(keyword);
  if (!q || q === 'karaoke') {
    throw new Error('Hay go ten bai hat hoac ca si de tim.');
  }
  const url =
    `${API_BASE}?part=snippet&type=video&videoEmbeddable=true` +
    `&maxResults=${Math.max(1, Math.min(25, Number(maxResults) || 8))}` +
    `&q=${encodeURIComponent(q)}&key=${encodeURIComponent(apiKey.trim())}`;
  const res = await fetchFn(url);
  if (!res.ok) {
    throw new Error(`YouTube API loi HTTP ${res.status}. Kiem tra lai key va gioi han su dung.`);
  }
  const data = await res.json();
  return (data.items || [])
    .filter((item) => item.id && item.id.videoId)
    .map((item) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      thumbnail: item.snippet.thumbnails && item.snippet.thumbnails.default
        ? item.snippet.thumbnails.default.url
        : '',
    }));
}

module.exports = { searchYouTube, extractVideoId, buildSearchQuery, isConfigured };
