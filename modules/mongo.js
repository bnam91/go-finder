import { MongoClient, ObjectId } from 'mongodb';
import { config } from '../config.js';

/** 스프레드시트별 MongoDB 설정 (config.channelConfig 없을 때 폴백) */
const MONGO_CONFIG = {
  잘사는김대리: {
    db: '03_project_ytb_gotrap',
    channel_alias: 'kimdaeri',
    keywordsCollection: 'gotrap_keywords_kimdaeri',
    crawlDatesCollection: 'gotrap_crawl_dates',
  },
  비빔면_더블루: {
    db: '03_project_ytb_gotrap',
    channel_alias: 'bibimmyeon_doubleblue',
    keywordsCollection: 'gotrap_keywords_bibimmyeon_doubleblue',
    crawlDatesCollection: 'gotrap_crawl_dates',
  },
};

function getMongoCfg(spreadsheet) {
  const ch = config.channelConfig;
  if (ch?.mongo) {
    return {
      db: ch.mongo.db,
      channel_alias: ch.channel_alias || spreadsheet,
      keywordsCollection: ch.mongo.keywordsCollection,
      crawlDatesCollection: ch.mongo.crawlDatesCollection,
    };
  }
  return MONGO_CONFIG[spreadsheet];
}

let client = null;

async function getClient() {
  const uri = process.env.uri || process.env.MONGODB_URI || process.env.MONGODB_URI_KIMDAERI;
  if (!uri) {
    throw new Error(
      'module_api_key/.env에 uri 또는 MONGODB_URI를 설정하세요. (예: uri="mongodb+srv://...")'
    );
  }
  if (!client) {
    client = new MongoClient(uri);
    await client.connect();
  }
  return client;
}

/** 스프레드시트 별칭이 MongoDB 저장을 지원하는지 확인 */
export function isMongoSupported(spreadsheet) {
  return getMongoCfg(spreadsheet) != null;
}

/** 스프레드시트별 channel_alias 반환 */
export function getChannelAlias(spreadsheet) {
  return getMongoCfg(spreadsheet)?.channel_alias || spreadsheet;
}

/** 크롤링 결과를 MongoDB에 저장 (키워드별) */
export async function saveKeywordsToMongo(allResults, spreadsheet) {
  const mongoCfg = getMongoCfg(spreadsheet);
  if (!mongoCfg || !allResults?.length) return;

  try {
    const c = await getClient();
    const db = c.db(mongoCfg.db);
    const coll = db.collection(mongoCfg.keywordsCollection);

    const byKeyword = {};
    for (const item of allResults) {
      const kw = item.keyword || '(키워드없음)';
      if (!byKeyword[kw]) byKeyword[kw] = [];
      byKeyword[kw].push(item);
    }

    for (const [keyword, items] of Object.entries(byKeyword)) {
      await coll.deleteMany({ keyword });
      if (items.length > 0) {
        await coll.insertMany(items);
      }
    }
    console.log(`\n총 ${allResults.length}건을 MongoDB에 저장했습니다: ${mongoCfg.db}.${mongoCfg.keywordsCollection}`);
  } catch (e) {
    console.error('MongoDB 저장 오류:', e.message);
  }
}

/** crawl-dates를 MongoDB에 저장 (채널별 1개 문서, keyword 객체 안에 키워드별 날짜) */
export async function saveCrawlDatesToMongo(crawlDates, spreadsheet) {
  const mongoCfg = getMongoCfg(spreadsheet);
  if (!mongoCfg || !crawlDates || Object.keys(crawlDates).length === 0) return;

  try {
    const c = await getClient();
    const db = c.db(mongoCfg.db);
    const coll = db.collection(mongoCfg.crawlDatesCollection);

    const channelAlias = mongoCfg.channel_alias || spreadsheet;
    const existing = await coll.findOne({ channel_name: spreadsheet });
    const existingKeywords = existing?.keyword || {};
    const mergedKeyword = { ...existingKeywords, ...crawlDates };

    await coll.updateOne(
      { channel_name: spreadsheet },
      {
        $set: {
          channel_name: spreadsheet,
          channel_alias: channelAlias,
          keyword: mergedKeyword,
        },
      },
      { upsert: true }
    );
    console.log(`크롤링 날짜를 MongoDB에 기록했습니다: ${mongoCfg.db}.${mongoCfg.crawlDatesCollection}`);
  } catch (e) {
    console.error('MongoDB crawl-dates 저장 오류:', e.message);
  }
}

/** MongoDB에서 키워드 데이터 로드 (followers/vpf 추가용) */
export async function loadKeywordsFromMongo(spreadsheet) {
  const mongoCfg = getMongoCfg(spreadsheet);
  if (!mongoCfg) return [];

  const c = await getClient();
  const db = c.db(mongoCfg.db);
  const coll = db.collection(mongoCfg.keywordsCollection);
  const docs = await coll.find({}).toArray();
  return docs;
}

/** gotrap_config 채널 문서로 키워드 데이터 로드 (Electron 앱용) */
export async function loadKeywordsForChannel(channelConfig) {
  if (!channelConfig?.mongo?.keywordsCollection) return [];
  const c = await getClient();
  const db = c.db(channelConfig.mongo.db || '03_project_ytb_gotrap');
  const coll = db.collection(channelConfig.mongo.keywordsCollection);
  return await coll.find({}).toArray();
}

/** 채널 컬렉션의 distinct keyword 목록 (히스토리용) */
export async function getKeywordHistory(channelConfig) {
  if (!channelConfig?.mongo?.keywordsCollection) return [];
  const c = await getClient();
  const db = c.db(channelConfig.mongo.db || '03_project_ytb_gotrap');
  const coll = db.collection(channelConfig.mongo.keywordsCollection);
  return await coll.distinct('keyword');
}

/** 특정 키워드의 데이터만 로드 (IPC 직렬화를 위해 _id를 문자열로 변환) */
export async function loadKeywordData(channelConfig, keyword) {
  if (!channelConfig?.mongo?.keywordsCollection) return [];
  const c = await getClient();
  const db = c.db(channelConfig.mongo.db || '03_project_ytb_gotrap');
  const coll = db.collection(channelConfig.mongo.keywordsCollection);
  const docs = await coll.find({ keyword }).toArray();
  return docs.map((d) => ({ ...d, _id: d._id?.toString?.() ?? String(d._id) }));
}

/** gotrap_crawl_dates에서 키워드 검색일 조회 (날짜만, YYYY-MM-DD) */
export async function getKeywordCrawlDate(channelConfig, keyword) {
  const collName = channelConfig?.mongo?.crawlDatesCollection;
  if (!collName || !keyword) return null;
  try {
    const c = await getClient();
    const db = c.db(channelConfig.mongo.db || '03_project_ytb_gotrap');
    const coll = db.collection(collName);
    const doc = await coll.findOne({ channel_name: channelConfig.channel_name });
    const isoStr = doc?.keyword?.[keyword];
    if (!isoStr || typeof isoStr !== 'string') return null;
    return isoStr.slice(0, 10);
  } catch (e) {
    return null;
  }
}

/** 특정 키워드의 데이터 MongoDB에서 삭제 */
export async function deleteKeywordData(channelConfig, keyword) {
  if (!channelConfig?.mongo?.keywordsCollection) return { deletedCount: 0 };
  const c = await getClient();
  const db = c.db(channelConfig.mongo.db || '03_project_ytb_gotrap');
  const coll = db.collection(channelConfig.mongo.keywordsCollection);
  const result = await coll.deleteMany({ keyword });
  return { deletedCount: result.deletedCount };
}

/** _id로 문서의 pick 필드 업데이트 */
export async function updateDocumentPick(channelConfig, docId, pick) {
  if (!channelConfig?.mongo?.keywordsCollection || !docId) return { ok: false };
  try {
    const c = await getClient();
    const db = c.db(channelConfig.mongo.db || '03_project_ytb_gotrap');
    const coll = db.collection(channelConfig.mongo.keywordsCollection);
    const id = typeof docId === 'string' ? new ObjectId(docId) : docId;
    await coll.updateOne({ _id: id }, { $set: { pick: !!pick } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** _id로 문서 삭제 */
export async function deleteDocumentById(channelConfig, docId) {
  if (!channelConfig?.mongo?.keywordsCollection || !docId) return { deletedCount: 0 };
  try {
    const c = await getClient();
    const db = c.db(channelConfig.mongo.db || '03_project_ytb_gotrap');
    const coll = db.collection(channelConfig.mongo.keywordsCollection);
    const id = typeof docId === 'string' ? new ObjectId(docId) : docId;
    const result = await coll.deleteOne({ _id: id });
    return { deletedCount: result.deletedCount };
  } catch (e) {
    throw new Error(e.message || 'MongoDB 삭제 실패');
  }
}

/** MongoDB에 키워드 데이터 일괄 저장 (기존 키워드별 삭제 후 삽입) */
export async function replaceKeywordsInMongo(itemsByKeyword, spreadsheet) {
  const mongoCfg = getMongoCfg(spreadsheet);
  if (!mongoCfg) return;

  const c = await getClient();
  const db = c.db(mongoCfg.db);
  const coll = db.collection(mongoCfg.keywordsCollection);

  for (const [keyword, items] of Object.entries(itemsByKeyword)) {
    await coll.deleteMany({ keyword });
    if (items.length > 0) {
      const toInsert = items.map(({ _id, ...doc }) => doc);
      await coll.insertMany(toInsert);
    }
  }
}

const GOTRAP_KEYWORD_PREFIX = 'gotrap_keywords_';
const GOTRAP_OUTPUT_PREFIX = 'gotrap_output_';
const GOTRAP_DB = '03_project_ytb_gotrap';
const GOTRAP_OUTPUT_COLL_DEFAULT = 'gotrap_output_';

/** gotrap_keywords_X → gotrap_output_X */
export function getOutputCollectionFromSource(sourceCollection) {
  if (!sourceCollection) return GOTRAP_OUTPUT_COLL_DEFAULT;
  if (sourceCollection.startsWith(GOTRAP_KEYWORD_PREFIX)) {
    const suffix = sourceCollection.slice(GOTRAP_KEYWORD_PREFIX.length);
    return `${GOTRAP_OUTPUT_PREFIX}${suffix}`;
  }
  return GOTRAP_OUTPUT_COLL_DEFAULT;
}

/** gotrap_keywords_ 접두어 컬렉션 목록 (번호 붙여 반환) */
export async function listGotrapKeywordCollections() {
  const c = await getClient();
  const db = c.db(GOTRAP_DB);
  const collections = await db.listCollections().toArray();
  const keywordColls = collections
    .map((c) => c.name)
    .filter((name) => name.startsWith(GOTRAP_KEYWORD_PREFIX))
    .sort();
  return keywordColls;
}

/** gotrap_keywords_* 컬렉션에서 distinct channel_id 조회 */
export async function getChannelIdsFromKeywordsCollection(collectionName) {
  const c = await getClient();
  const db = c.db(GOTRAP_DB);
  const coll = db.collection(collectionName);
  const ids = await coll.distinct('channel_id');
  return ids.filter((id) => id && String(id).trim()).map((id) => String(id).trim());
}

/** gotrap_output_* 에 완료된 channelId 목록 (status='완료' 또는 status 없음=구버전) */
export async function getAnalyzedChannelIds(outputCollection = GOTRAP_OUTPUT_COLL_DEFAULT) {
  const c = await getClient();
  const db = c.db(GOTRAP_DB);
  const coll = db.collection(outputCollection);
  const ids = await coll.distinct('channelId', {
    $or: [{ status: '완료' }, { status: { $exists: false } }],
  });
  return new Set(ids.filter((id) => id));
}

/** 큐 시드: 처리할 채널들을 status='대기중'으로 upsert */
export async function seedChannelQueue(outputCollection, channelIds) {
  if (!channelIds?.length) return 0;
  const c = await getClient();
  const db = c.db(GOTRAP_DB);
  const coll = db.collection(outputCollection);
  const ops = channelIds.map((channelId) => ({
    updateOne: {
      filter: { channelId },
      update: { $set: { channelId, status: '대기중', updatedAt: new Date() } },
      upsert: true,
    },
  }));
  const r = await coll.bulkWrite(ops);
  return r.upsertedCount + r.modifiedCount;
}

/** 대기중 → 작업중 원자적 클레임. workerId로 어떤 워커가 처리 중인지 표시 */
export async function claimChannel(outputCollection, workerId) {
  const c = await getClient();
  const db = c.db(GOTRAP_DB);
  const coll = db.collection(outputCollection);
  const doc = await coll.findOneAndUpdate(
    { status: '대기중' },
    { $set: { status: '작업중', workerId, startedAt: new Date(), updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  return doc;
}

/** 작업 완료: 채널 데이터 저장 + status='완료' */
export async function completeChannel(outputCollection, channelId, fullDoc, sourceCollection = null) {
  const c = await getClient();
  const db = c.db(GOTRAP_DB);
  const coll = db.collection(outputCollection);
  const toSave = {
    ...fullDoc,
    status: '완료',
    completedAt: new Date(),
    updatedAt: new Date(),
    sourceCollection: sourceCollection || undefined,
  };
  await coll.updateOne(
    { channelId },
    { $set: toSave, $unset: { workerId: '', startedAt: '' } }
  );
}

/** 작업 실패: 작업중 → 대기중으로 되돌려 재시도 가능하게 */
export async function releaseChannel(outputCollection, channelId) {
  const c = await getClient();
  const db = c.db(GOTRAP_DB);
  const coll = db.collection(outputCollection);
  await coll.updateOne(
    { channelId },
    { $set: { status: '대기중', updatedAt: new Date() }, $unset: { workerId: '', startedAt: '' } }
  );
}

/** 채널 분석 결과를 gotrap_output_* 컬렉션에 저장. opts.upsert=true면 기존 문서 덮어쓰기(최신화) */
export async function saveChannelAnalysisToMongo(doc, sourceCollection = null, opts = {}) {
  if (!doc || !doc.channelId) return;
  try {
    const outputColl = getOutputCollectionFromSource(sourceCollection);
    const c = await getClient();
    const db = c.db(GOTRAP_DB);
    const coll = db.collection(outputColl);
    const toSave = { ...doc, status: '완료', updatedAt: new Date() };
    if (sourceCollection) toSave.sourceCollection = sourceCollection;
    if (!toSave.createdAt) toSave.createdAt = toSave.updatedAt;

    if (opts.upsert) {
      await coll.updateOne({ channelId: doc.channelId }, { $set: toSave }, { upsert: true });
      console.log(`MongoDB 업데이트: ${outputColl} ← ${doc.channelId}`);
    } else {
      await coll.insertOne(toSave);
      console.log(`MongoDB 저장: ${outputColl} ← ${doc.channelId}`);
    }
  } catch (e) {
    console.error('MongoDB 채널분석 저장 오류:', e.message);
  }
}

/** 연결 종료 */
export async function closeMongoClient() {
  if (client) {
    await client.close();
    client = null;
  }
}
