/** 환경변수로 덮어쓸 수 있는 기본 설정 */
export const config = {
  /** 1=개발 모드 (크롤링 끝나도 크롬 창 유지), 0=종료 시 브라우저 닫기. ELECTRON_DEV=1이면 devMode 자동 활성화 */
  devMode: Number(process.env.DEV_MODE) || (process.env.ELECTRON_DEV === '1' ? 1 : 0),

  /**
   * 크롤링 결과 저장 방식 (1=해당 방법으로 저장, 0=저장 안 함)
   * - spreadsheet: Google 스프레드시트 channel_id 시트
   * - json: JSON 파일 (jsonOutputPath 경로)
   * - mongo: MongoDB (채널별 gotrap_config에 정의된 컬렉션 사용)
   */
  output: [
    ['spreadsheet', process.env.OUTPUT_SPREADSHEET !== undefined ? Number(process.env.OUTPUT_SPREADSHEET) : 0],
    ['json', process.env.OUTPUT_JSON !== undefined ? Number(process.env.OUTPUT_JSON) : 1],
    ['mongo', process.env.OUTPUT_MONGO !== undefined ? Number(process.env.OUTPUT_MONGO) : 0],
  ],

  /** output에서 json이 1일 때 저장할 파일 경로 (절대/상대 경로 가능). 기본: ./output/{spreadsheet}/crawl-results.json */
  jsonOutputPath: process.env.JSON_OUTPUT_PATH || `./output/${process.env.SPREADSHEET || 'default'}/crawl-results.json`,

  /**
   * 사용할 스프레드시트 (별칭). 이 스프레드시트의 keyword 시트에서 키워드를 읽고, channel_id 시트에 결과를 저장합니다.
   */
  spreadsheet: process.env.SPREADSHEET || 'default',

  /**
   * 스프레드시트 목록 (별칭 -> 스프레드시트 ID, URL의 /d/ 다음 부분)
   */
  spreadsheets: {
    기본: process.env.SPREADSHEET_ID || '12XNfmESEKc2YBVwqyHa7NHnRXY6MfCvSsuuIcaYpv1Q',
    ...(process.env.SPREADSHEET && process.env.SPREADSHEET_ID
      ? { [process.env.SPREADSHEET]: process.env.SPREADSHEET_ID }
      : {}),
  },

  /** 시트 이름 (각 스프레드시트에서 사용할 시트 이름) */
  sheets: {
    keyword: 'keyword',
    channelId: 'channel_id',
  },

  /** 한 번에 시트에 추가할 행 수 (spreadsheet 모드에서만 사용) */
  batchSize: Number(process.env.BATCH_SIZE) || 50,

  /** Puppeteer 옵션 (Electron 앱에서는 항상 브라우저 표시) */
  puppeteer: {
    headless: process.env.HEADLESS === 'true' && !process.versions.electron,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--start-maximized',
    ],
  },

  /** 검색 결과 탭: 1=전체, 2=Shorts, 3=동영상 */
  searchTab: Number(process.env.SEARCH_TAB) || 3,

  /** 키워드당 크롤링 수 (runCrawlWithConfig에서 설정, Infinity=전체) */
  crawlCount: Number(process.env.CRAWL_COUNT) || 100,

  /** 제목에 키워드 포함된 비디오만 수집 */
  filterByKeyword: process.env.FILTER_BY_KEYWORD === '1' || process.env.FILTER_BY_KEYWORD === 'y',

  /** 벌크 필터 적용: 한글 제목만, views>200, upload_date에 '년 전' 제외 */
  applyBulkFilter: process.env.APPLY_BULK_FILTER === '1' || process.env.APPLY_BULK_FILTER === 'y',

  /** 구독자 수 API 호출 생략 (standalone 크롤링 시 사용) */
  skipFollowersApi: process.env.SKIP_FOLLOWERS_API === '1' || process.env.SKIP_FOLLOWERS_API === 'y',

  /** 크롤링 동작 */
  crawl: {
    /** 스크롤 후 대기 시간(ms) - 너무 짧으면 새 콘텐츠 로드 전에 크롤링해 누락 발생 */
    scrollWaitMs: 3000,
    /** DOM 안정화 대기: 스크롤 후 title-wrapper 개수가 이전과 같아질 때까지 폴링 간격(ms) */
    domStablePollMs: 1200,
    /** DOM 안정화 최대 대기 횟수 (이 횟수만큼 폴링 후에도 개수 증가 시 계속 진행) */
    domStableMaxPolls: 6,
    /** 탭 클릭 후 대기 시간(ms) */
    tabWaitMs: 5000,
    /** 새 데이터 없음이 이 횟수만큼 연속이면 종료 */
    noNewDataLimit: 3,
    /** 탭 셀렉터 대기 시간(ms) */
    tabTimeoutMs: 10000,
  },
};

export default config;
