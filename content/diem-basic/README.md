# DIEM Basic 사전 제작 큐

이 디렉터리는 실시간 뉴스와 분리된 저장형 경제 교육 콘텐츠의 원본입니다.
GitHub Actions는 여기서 다음 `ready` 패키지의 완성된 `reel.mp4`를 읽어
발행할 뿐, 주제를 고르거나 LLM으로 원고를 바꾸거나 웹 이미지를 찾지 않습니다.

## 한 패키지의 구성

- `content.json`: 5장 수업 원고, 보충용 3문장 본문, 댓글, 공식 출처,
  장면별 주장 근거, 재검토 기한, 디자인·음원·무결성 정보
- `brief.md`: 사람이 읽는 학습 목표, 자료 검증 이유, 문안·디자인 의도
- `cards/card-01.png` ~ `card-05.png`: 질문·정의·작동·주의·요약을 담은
  1080×1920 교육 카드
- `cover.png`: 첫 번째 질문 카드와 바이트가 같은 Instagram 표지
- `reel.mp4`: 5장의 정적 페이드와 검증된 음원을 합친 19초 업로드 파일

## 제작·수정 순서

1. `.codex/skills/diem-basic-production/SKILL.md`의 절차로 주제와 공식 자료를
   검증합니다.
2. `_template/content.template.json`을 복제해 원고와 주장-출처 매핑을
   작성합니다.
3. `node scripts/build-diem-basic-packages.js --id <content-id>`로 카드 5장,
   표지, 19초 Reel과 모든 SHA-256을 다시 만듭니다.
4. `npm test`와 `node .codex-harness/scripts/verify-project.mjs`를 통과시킵니다.
5. 발행 전 `review.expiresAt`과 원문 링크를 다시 확인합니다.

완성 파일을 수동 편집하면 해시가 달라져 발행이 차단됩니다. 원고나 디자인을
고쳤다면 반드시 빌드 스크립트로 표지·Reel·해시를 함께 갱신합니다.
