import { createInterface } from 'readline';
import { getChannels, addChannel, isKeywordsCollectionTaken } from './channelConfig.js';

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export function loadUserSpreadsheets() {
  return {};
}

async function selectChannel() {
  const channels = await getChannels();
  if (channels.length === 0) {
    console.log('등록된 채널이 없습니다. a를 입력해 추가하세요.');
  }

  const lines = channels.map((ch, i) => `  ${i + 1}. ${ch.channel_name} (${ch.channel_alias || '-'})`).join('\n');
  const prompt = `채널 선택:\n${lines || '  (없음)'}\n  a. 추가  (번호 또는 a): `;

  const input = await ask(prompt);
  const lower = input.toLowerCase();

  if (lower === 'a') {
    await addChannelInteractive();
    return selectChannel();
  }

  const num = parseInt(input, 10);
  if (num >= 1 && num <= channels.length) {
    return channels[num - 1];
  }

  const byName = channels.find((ch) => ch.channel_name === input || ch.channel_alias === input);
  if (byName) return byName;

  console.log('잘못된 입력입니다. 다시 선택해주세요.');
  return selectChannel();
}

async function addChannelInteractive() {
  const channel_name = await ask('채널명: ');
  if (!channel_name) {
    console.log('취소했습니다.');
    return;
  }
  let channel_alias;
  while (true) {
    channel_alias = await ask('채널 별칭 (예: kimdaeri): ') || channel_name;
    if (!channel_alias) {
      console.log('취소했습니다.');
      return;
    }
    const keywordsCollection = `gotrap_keywords_${channel_alias}`;
    if (!(await isKeywordsCollectionTaken(keywordsCollection))) break;
    console.log(`'${keywordsCollection}' 컬렉션은 이미 사용 중입니다. 다른 별칭을 입력하세요.`);
  }
  const spreadsheetId = (await ask('스프레드시트 ID (URL의 /d/ 다음 부분, 비워두면 나중에 수기 입력): '))?.trim() || '';

  const doc = {
    channel_name,
    channel_alias,
    spreadsheet: {
      id: spreadsheetId,
      sheets: { keyword: 'keyword', channelId: 'channel_id' },
    },
    mongo: {
      db: '03_project_ytb_gotrap',
      keywordsCollection: `gotrap_keywords_${channel_alias}`,
      crawlDatesCollection: 'gotrap_crawl_dates',
    },
  };
  await addChannel(doc);
}

async function selectOutput(channelConfig) {
  const mongoSupported = !!channelConfig?.mongo;
  const prompt = mongoSupported
    ? `저장 방식:\n  1. MongoDB  2. 시트  3. JSON  (1/2/3, 기본 1): `
    : `저장 방식:\n  1. 시트  2. JSON  (1/2, 기본 1): `;
  const input = (await ask(prompt)) || '1';
  const n = parseInt(input, 10) || 1;

  if (mongoSupported) {
    return {
      spreadsheet: n === 2 ? 1 : 0,
      json: n === 3 ? 1 : 0,
      mongo: n === 1 ? 1 : 0,
    };
  }
  return {
    spreadsheet: n === 1 ? 1 : 0,
    json: n === 2 ? 1 : 0,
    mongo: 0,
  };
}

async function selectSearchTab() {
  const tabMap = { 1: '전체', 2: 'Shorts', 3: '동영상' };
  const prompt = `검색 탭:\n  1. 전체  2. Shorts  3. 동영상  (1/2/3, 기본 3): `;
  const input = (await ask(prompt)) || '3';
  const n = input === '1' ? 1 : input === '2' ? 2 : 3;
  return { searchTab: n, tabLabel: tabMap[n] };
}

/**
 * 터미널에서 채널·저장방식·검색탭 선택. 추가(a) 지원.
 * MongoDB gotrap_config에서 채널 목록 조회.
 * @returns {{ spreadsheet: string, channelConfig: object, output: object, searchTab: number, tabLabel: string }}
 */
export async function promptRunConfig() {
  console.log('\n--- 실행 설정 ---');
  const channelConfig = await selectChannel();
  if (!channelConfig) return null;

  const spreadsheet = channelConfig.channel_name;
  const output = await selectOutput(channelConfig);
  const { searchTab, tabLabel } = await selectSearchTab();
  const saveLabels = [];
  if (output.json) saveLabels.push('JSON');
  if (output.spreadsheet) saveLabels.push('시트');
  if (output.mongo) saveLabels.push('MongoDB');
  console.log(`선택: 채널 '${spreadsheet}', 저장=${saveLabels.join('+') || '없음'}, 탭=${tabLabel}\n`);

  return { spreadsheet, channelConfig, output, searchTab, tabLabel };
}
