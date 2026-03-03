/**
 * 채널 구독 목록 조회 스크립트
 * 기본: @잘사는김대리
 * 사용: node scripts/subscriptions.js [채널핸들] [--oauth]
 *
 * --oauth: OAuth 2.0 인증 사용 (비공개 구독 목록 조회용, module_auth 필요)
 */
import '../loadEnv.js';
import { fetchChannelInfo } from '../indicator/modules/youtube.js';
import { fetchSubscriptionList } from '../indicator/modules/subscriptions.js';
import { parseChannelFromInput } from '../indicator/utils/url.js';

async function main() {
  const args = process.argv.slice(2);
  const useOAuth = args.includes('--oauth');
  const input = args.find((a) => !a.startsWith('-')) ?? '@잘사는김대리';
  const handleOrId = parseChannelFromInput(input) || input.trim();

  if (!handleOrId) {
    console.log('사용법: node scripts/subscriptions.js [@채널핸들] [--oauth]');
    process.exit(1);
  }

  console.log(`\n채널: ${handleOrId} 구독 목록 조회 중...${useOAuth ? ' (OAuth)' : ''}\n`);

  try {
    const channel = await fetchChannelInfo(handleOrId);
    if (!channel) {
      console.error('해당 채널을 찾을 수 없습니다.');
      process.exit(1);
    }

    const channelId = channel.id;
    const channelTitle = channel.snippet?.title ?? handleOrId;

    let subscriptions;
    try {
      subscriptions = await fetchSubscriptionList(channelId, 500, { useOAuth });
    } catch (err) {
      if (err.needOAuth) {
        console.error(err.message);
        console.error('예: node scripts/subscriptions.js @잘사는김대리 --oauth');
      } else if (err.message?.includes('insufficient authentication scopes')) {
        console.error('OAuth 토큰에 YouTube 권한이 없습니다.');
        console.error('module_auth에서 https://www.googleapis.com/auth/youtube.readonly 스코프로 재인증하세요.');
      } else {
        throw err;
      }
      process.exit(1);
    }

    console.log(`📋 ${channelTitle} 구독 중인 채널 (${subscriptions.length}개)\n`);
    console.log('='.repeat(60));

    subscriptions.forEach((item, i) => {
      const s = item.snippet;
      const title = s?.title ?? '(제목 없음)';
      const subChannelId = s?.resourceId?.channelId;
      const url = subChannelId
        ? `https://www.youtube.com/channel/${subChannelId}`
        : '-';
      console.log(`${String(i + 1).padStart(3)}. ${title}`);
      console.log(`     ${url}`);
    });

    console.log('\n');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

main();
