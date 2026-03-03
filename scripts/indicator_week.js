/**
 * Indicator 진입점: 채널 구독자 수 및 최근 7일 이내 업로드 영상(Shorts 제외) 출력
 */
import '../loadEnv.js';
import { main } from '../indicator/index.js';

main({ weekOnly: true, channelsFromSheet: true }).catch((err) => {
  console.error(err);
  process.exit(1);
});
