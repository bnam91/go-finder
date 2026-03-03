/**
 * YouTube Data API v3를 사용해 채널 구독자 수와 최근 업로드 영상(Shorts 제외) 8개를 출력합니다.
 * 인자 없이 실행 시: URL 직접 입력 / channel_list.json 불러오기 중 선택
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { fetchChannelInfo, fetchRecentVideosExcludingShorts } from './modules/youtube.js';
import { ask } from './utils/prompt.js';
import { resolveChannelIdFromSheet, getAllChannelsFromSheet } from './utils/sheetLookup.js';
import { parseChannelFromInput } from './utils/url.js';
import { analyzeViewCounts } from './utils/viewAnalysis.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CHANNEL_LIST_PATH = path.join(__dirname, 'channel_list.json');

async function promptChannelSource() {
  console.log('\n채널 조회 방식을 선택하세요:');
  console.log('  1) URL 또는 핸들 직접 입력');
  console.log('  2) channel_list.json에서 불러오기');
  const input = await ask('\n선택 (1 또는 2) 또는 채널 입력 (예: @ITSUB): ');

  if (input === '2') {
    try {
      const json = readFileSync(CHANNEL_LIST_PATH, 'utf-8');
      const list = JSON.parse(json);
      return Array.isArray(list) ? list : [list];
    } catch (err) {
      console.error(`channel_list.json 읽기 실패: ${err.message}`);
      return null;
    }
  }

  if (input === '1') {
    const channelInput = await ask('채널 URL 또는 핸들 입력: ');
    const parsed = parseChannelFromInput(channelInput);
    return parsed ? [parsed] : null;
  }

  // 1, 2가 아니면 채널 입력으로 간주
  const parsed = parseChannelFromInput(input);
  if (parsed) return [parsed];

  console.log('1, 2 또는 채널 핸들/URL을 입력하세요.');
  return null;
}

const isInteractive = () => process.stdin.isTTY;

/** 최근 N시간 이내 업로드 여부 */
function isWithinHours(publishedAt, hours) {
  if (!publishedAt) return false;
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return new Date(publishedAt).getTime() >= cutoff;
}

export async function main(options = {}) {
  const { weekOnly = false, dayOnly = false, channelsFromSheet = false } = options;
  const withinHours = dayOnly ? 24 : weekOnly ? 168 : null;
  let handles = process.argv.slice(2);
  let choiceArg = null;
  if (handles.length >= 2 && /^\d+$/.test(handles[handles.length - 1])) {
    choiceArg = parseInt(handles.pop(), 10);
  }

  if (handles.length === 0) {
    if (channelsFromSheet) {
      const channels = await getAllChannelsFromSheet();
      handles = channels.map((c) => c.channelId);
    }
    if (handles.length === 0) {
      if (!isInteractive()) {
        console.log('채널을 인자로 입력하세요. 예: node indicator.js @잘사는김대리');
        return;
      }
      const result = await promptChannelSource();
      if (!result || result.length === 0) {
        console.log('실행을 취소합니다.');
        return;
      }
      handles = result;
    }
  }

  if (dayOnly) {
    console.log('✅ 레퍼런스 채널 중 최근 24시간 이내 업로드된 영상 목록입니다.\n');
  }

  for (const handle of handles) {
    let h = (handle || '').trim();
    if (!h) continue;

    // @ 또는 URL이면 직접 사용, 아니면 시트에서 채널명으로 채널ID 조회
    const parsed = parseChannelFromInput(h);
    if (parsed && (h.startsWith('@') || h.startsWith('http'))) {
      h = parsed;
    } else {
      const matches = await resolveChannelIdFromSheet(h);
      if (matches.length === 1) {
        h = matches[0].channelId;
        console.log(`시트에서 매칭: "${handle}" → ${h}`);
      } else if (matches.length > 1) {
        console.log(`\n"${handle}" 검색 결과 (${matches.length}개):`);
        matches.forEach((m, i) => {
          console.log(`  ${i + 1}. ${m.channelName} (${m.channelId})`);
        });

        let choiceNum = choiceArg;
        if (choiceNum == null && isInteractive()) {
          choiceNum = parseInt(await ask(`\n번호 선택 (1–${matches.length}): `), 10);
        }

        if (choiceNum >= 1 && choiceNum <= matches.length) {
          h = matches[choiceNum - 1].channelId;
          console.log(`선택: ${h}`);
        } else if (!isInteractive()) {
          console.log(`\n선택하려면: /분석 ${handle} <번호>`);
          continue;
        } else {
          console.log('잘못된 번호입니다. 건너뜁니다.');
          continue;
        }
      } else {
        console.log(`시트에서 "${handle}"에 해당하는 채널을 찾을 수 없습니다.`);
        continue;
      }
    }

    try {
      const channel = await fetchChannelInfo(h);
      if (!channel) {
        console.log('해당 채널을 찾을 수 없거나 비공개입니다.');
        continue;
      }

      const { snippet, statistics, contentDetails } = channel;
      const subscriberCount = Number(statistics?.subscriberCount ?? 0);
      const formatted = subscriberCount.toLocaleString('ko-KR');

      const uploadsId = contentDetails?.relatedPlaylists?.uploads;
      if (!uploadsId) {
        if (withinHours == null) {
          console.log('\n' + '='.repeat(24));
          console.log(`채널: ${h}`);
          console.log('='.repeat(24));
          console.log('\n최근 영상: (업로드 플레이리스트 없음)');
        }
        continue;
      }

      const { items: videos, detailsMap } = await fetchRecentVideosExcludingShorts(uploadsId, 8);
      const displayVideos =
        withinHours != null ? videos.filter((v) => isWithinHours(v.snippet?.publishedAt, withinHours)) : videos;

      if (withinHours != null && displayVideos.length === 0) continue;

      console.log('\n\n' + '='.repeat(24));
      console.log(`채널: ${h}`);
      console.log('='.repeat(24));
      console.log(`\n📊 구독자 수: ${formatted}명`);
      console.log(`   채널명: ${snippet?.title ?? '-'}`);

      const { average, aboveAverage } = analyzeViewCounts(displayVideos, detailsMap);

      const header =
        withinHours != null ? '\n' : `\n[Shorts 제외] 최근 업로드 영상 8개\n(평균 조회수 : ${Math.round(average).toLocaleString('ko-KR')}회) :\n`;
      console.log(header);
      if (!displayVideos.length) {
        console.log('   (Shorts 제외 동영상이 없습니다)');
      }
      const emojiNums = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
      displayVideos.forEach((item, i) => {
        const s = item.snippet;
        const title = s?.title ?? '(제목 없음)';
        const videoId = s?.resourceId?.videoId;
        const publishedAt = s?.publishedAt ?? '';
        const dateStr = publishedAt ? publishedAt.slice(0, 10) : '-';
        const { viewCount } = detailsMap.get(videoId) ?? {};
        const link = videoId ? `https://www.youtube.com/watch?v=${videoId}` : '-';
        const viewStr = viewCount != null ? viewCount.toLocaleString('ko-KR') : '-';
        const aboveLabel = videoId && aboveAverage.has(videoId) ? ' 🟢 평균↑' : '';
        const num = emojiNums[i] ?? `${i + 1}.`;
        const pctStr =
          withinHours != null && subscriberCount > 0 && viewCount != null
            ? ` (구독자 대비 ${Math.round((Number(viewCount) / subscriberCount) * 100)}%)`
            : '';
        console.log(`${num} ${title}${aboveLabel}`);
        console.log(`   • 조회수: ${viewStr}회${pctStr}`);
        console.log(`   • 업로드: ${dateStr}`);
        console.log(`   • 링크: ${link}`);
        if (i < displayVideos.length - 1) console.log('');
      });
    } catch (err) {
      console.error(`오류: ${err.message}`);
    }
  }
  console.log('\n');
}
