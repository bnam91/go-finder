/**
 * YouTube URL에서 채널 핸들(@xxx) 또는 채널 ID(UCxxx) 추출
 */
export function parseChannelFromInput(input) {
  const s = (input || '').trim();
  if (!s) return null;

  // 이미 @핸들 또는 UC채널ID 형식
  if (s.startsWith('@') || /^UC[\w-]{22}$/.test(s)) return s;

  // http로 시작하면 URL로 파싱
  if (s.startsWith('http://') || s.startsWith('https://')) {
    try {
      const url = new URL(s);
      const host = url.hostname.replace(/^www\./, '');
      if (!['youtube.com', 'youtu.be', 'm.youtube.com'].some((h) => host.includes(h))) {
        return null;
      }
      const handleMatch = url.pathname.match(/\/@([^/]+)/);
      if (handleMatch) return `@${handleMatch[1]}`;
      const channelMatch = url.pathname.match(/\/channel\/(UC[\w-]{22})/);
      if (channelMatch) return channelMatch[1];
    } catch {
      return null;
    }
    return null;
  }

  // URL이 아니면 핸들로 간주 (앞에 @ 없으면 그대로 - API가 처리)
  return s;
}
