#!/usr/bin/env python3
"""
YouTube 구독 목록 HTML에서 채널명과 채널 ID(핸들)를 추출합니다.
"""

import html
import re
import sys
from pathlib import Path
from urllib.parse import unquote


def extract_subscriptions(html_path: str) -> list[dict[str, str]]:
    """
    HTML 파일에서 구독 채널 목록을 추출합니다.
    Returns: [{"name": "채널명", "channel_id": "@handle"}, ...]
    """
    html_path = Path(html_path)
    if not html_path.exists():
        raise FileNotFoundError(f"파일을 찾을 수 없습니다: {html_path}")

    content = html_path.read_text(encoding="utf-8")

    # ytd-guide-entry-renderer 내의 <a href="/@handle" title="채널명"> + img src(프로필 이미지) 패턴 매칭
    # "구독", "더보기" 등은 href가 /@로 시작하지 않으므로 제외됨
    pattern = re.compile(
        r'href="(/@[^"]+)"[^>]*title="([^"]+)"[\s\S]*?src="(https://[^"]+)"',
        re.DOTALL
    )

    channels = []
    seen = set()

    for match in pattern.finditer(content):
        handle_path = match.group(1)   # /@yooon 또는 /@%EB%AF%B8%EB%8B%88%ED%94%BC
        channel_name = match.group(2)
        profile_image = match.group(3)  # 프로필 이미지 URL

        # 구독, 더보기 등 제외
        if channel_name in ("구독", "더보기"):
            continue

        channel_name = html.unescape(channel_name)  # &amp; -> &

        # channel_id: @handle 형식 (URL 디코딩)
        channel_id = unquote(handle_path)  # /@xxx -> /@xxx, /@%EB%AF%... -> /@미니피
        if channel_id.startswith("/@"):
            channel_id = channel_id[1:]  # @yooon

        # 중복 제거 (같은 채널이 여러 번 나올 수 있음)
        key = (channel_name, channel_id)
        if key not in seen:
            seen.add(key)
            channels.append({
                "name": channel_name,
                "channel_id": channel_id,
                "profile_image": profile_image,
            })

    return channels


def main():
    # 기본 HTML 파일 경로
    script_dir = Path(__file__).parent
    default_html = script_dir / "잘사는김대리_02.21.html"

    html_path = sys.argv[1] if len(sys.argv) > 1 else str(default_html)

    try:
        channels = extract_subscriptions(html_path)
    except FileNotFoundError as e:
        print(f"오류: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"총 {len(channels)}개 채널\n")
    print("-" * 60)

    for i, ch in enumerate(channels, 1):
        print(f"{i:3}. {ch['name']}")
        print(f"     {ch['channel_id']}")
        print(f"     {ch['profile_image']}")
        print()


if __name__ == "__main__":
    main()
