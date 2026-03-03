/**
 * gotrap_config 컬렉션에서 채널 목록 조회/추가
 * MongoDB 03_project_ytb_gotrap.gotrap_config
 */
import { MongoClient } from 'mongodb';

const DB = '03_project_ytb_gotrap';
const COLLECTION = 'gotrap_config';

let client = null;

async function getMongoClient() {
  const uri = process.env.uri || process.env.MONGODB_URI || process.env.MONGODB_URI_KIMDAERI;
  if (!uri) throw new Error('module_api_key/.env에 uri를 설정하세요.');
  if (!client) {
    client = new MongoClient(uri);
    await client.connect();
  }
  return client;
}

/** gotrap_config에서 채널 목록 조회 */
export async function getChannels() {
  try {
    const c = await getMongoClient();
    const coll = c.db(DB).collection(COLLECTION);
    const docs = await coll.find({}).sort({ channel_name: 1 }).toArray();
    return docs;
  } catch (e) {
    console.error('채널 목록 조회 오류:', e.message);
    return [];
  }
}

/** gotrap_config에 해당 키워드 컬렉션을 쓰는 채널이 이미 있는지 확인 */
export async function isKeywordsCollectionTaken(keywordsCollection) {
  const c = await getMongoClient();
  const coll = c.db(DB).collection(COLLECTION);
  const existing = await coll.findOne({ 'mongo.keywordsCollection': keywordsCollection });
  return !!existing;
}

/** gotrap_config에 채널 문서 추가 + gotrap_keywords_{alias} 빈 컬렉션 생성 */
export async function addChannel(doc) {
  const c = await getMongoClient();
  const db = c.db(DB);

  const keywordsCollection = doc.mongo?.keywordsCollection;
  if (keywordsCollection) {
    const list = await db.listCollections({ name: keywordsCollection }).toArray();
    const exists = list.length > 0;
    if (!exists) {
      await db.createCollection(keywordsCollection);
      console.log(`'${keywordsCollection}' 컬렉션을 생성했습니다.`);
    }
  }

  const coll = db.collection(COLLECTION);
  await coll.insertOne(doc);
  console.log(`'${doc.channel_name}' 채널을 추가했습니다.`);
}
