const YOUTUBE_URL_PATTERN = /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)/;

const VIDEO_ID_PATTERNS = [
  /youtube\.com\/watch\?v=([^&]+)/,
  /youtube\.com\/embed\/([^?]+)/,
  /youtube\.com\/v\/([^?]+)/,
  /youtube\.com\/shorts\/([^?]+)/,
  /youtu\.be\/([^?]+)/,
];

export function isYouTubeUrl(url: string): boolean {
  return YOUTUBE_URL_PATTERN.test(url);
}

export function extractVideoId(url: string): string | null {
  for (const pattern of VIDEO_ID_PATTERNS) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}
