#!/usr/bin/env python3
"""
gotrap_config 컬렉션에 채널 설정 업로드 (임시 유틸)
실행: python utils/upload_channel_config.py
사용자가 입력한 값으로 채널 설정을 MongoDB에 업로드합니다.
"""
import os
import sys
from pathlib import Path

# 프로젝트 루트
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# .env 로드 (module_api_key)
try:
    import dotenv
    env_path = os.environ.get("ENV_PATH") or os.path.expanduser(
        "~/Documents/github_cloud/module_api_key/.env"
    )
    dotenv.load_dotenv(env_path)
except ImportError:
    pass

from pymongo import MongoClient


def prompt(question, default=""):
    """사용자 입력을 받습니다. 기본값이 있으면 빈 입력 시 기본값 사용."""
    if default:
        text = input(f"{question} (기본: {default}): ").strip() or default
    else:
        text = input(f"{question}: ").strip()
    return text


def main():
    print("\n--- 채널 설정 입력 ---")
    channel_name = prompt("채널명")
    if not channel_name:
        print("채널명은 필수입니다. 취소합니다.")
        return

    channel_alias = prompt("채널 별칭", channel_name)
    spreadsheet_id = prompt("스프레드시트 ID (URL의 /d/ 다음 부분)")
    keyword_sheet = prompt("키워드 시트명", "keyword")
    channel_id_sheet = prompt("channel_id 시트명", "channel_id")

    mongo_db = prompt("MongoDB DB명", "03_project_ytb_gotrap")
    keywords_collection = prompt("MongoDB 키워드 컬렉션", f"gotrap_keywords_{channel_alias}")
    crawl_dates_collection = prompt("MongoDB crawl-dates 컬렉션", "gotrap_crawl_dates")

    channel_config = {
        "channel_name": channel_name,
        "channel_alias": channel_alias,
        "spreadsheet": {
            "id": spreadsheet_id.strip(),
            "sheets": {
                "keyword": keyword_sheet,
                "channelId": channel_id_sheet,
            },
        },
        "mongo": {
            "db": mongo_db,
            "keywordsCollection": keywords_collection,
            "crawlDatesCollection": crawl_dates_collection,
        },
    }

    uri = os.environ.get("uri") or os.environ.get("MONGODB_URI") or os.environ.get("MONGODB_URI_KIMDAERI")
    if not uri:
        uri = "mongodb+srv://coq3820:JmbIOcaEOrvkpQo1@cluster0.qj1ty.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"
        print("⚠️  env에서 uri를 찾지 못해 기본 URI 사용")

    client = MongoClient(uri, tlsAllowInvalidCertificates=True)
    db = client["03_project_ytb_gotrap"]  # gotrap_config는 항상 이 DB에 저장
    coll = db["gotrap_config"]

    result = coll.update_one(
        {"channel_name": channel_config["channel_name"]},
        {"$set": channel_config},
        upsert=True,
    )

    if result.upserted_id:
        print(f"✅ '{channel_config['channel_name']}' 채널 설정을 새로 추가했습니다.")
    else:
        print(f"✅ '{channel_config['channel_name']}' 채널 설정을 업데이트했습니다.")

    print(f"   → {db.name}.{coll.name}")
    client.close()


if __name__ == "__main__":
    main()
