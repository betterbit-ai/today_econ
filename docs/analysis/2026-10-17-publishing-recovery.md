# 2026-10-17 토큰 재연결과 정상 발행 확인

## 인증 확인

사용자가 Secret 갱신을 완료했다고 알린 뒤 `INSTAGRAM_ACCESS_TOKEN` 갱신 시각만 확인했다: 2026-10-17 11:58:27 KST. 토큰 값은 조회·출력하지 않았다.

[진단 38997003830](https://github.com/betterbit-ai/today_econ/actions/runs/38997003830), SHA `f21b8454f9ded5865c748be6533687716d4fbf22`: `repository_secret`에서 계정 `17841433257606150`·사용자명 `diem.magazine` 일치, Models API `qwen/qwen3.8-27b` 정상, 실제 두 이미지 검수 5회 연속 성공. 읽기 성공과 실제 업로드 성공은 구분한다.

## 정상 발행 실행과 이미지 공백 복구

- [경제 38997381035](https://github.com/betterbit-ai/today_econ/actions/runs/38997381035): 농지 기사 원고 검사 후 관련 이미지 미매핑. 다음 후보는 숫자 의미 검사를 통과하지 못해 `no_candidate_passed_preparation`으로 미발행. Reel 시도 0·외부 ID 없음.
- [시사 38997399550](https://github.com/betterbit-ai/today_econ/actions/runs/38997399550): `no_candidate_passed_hotness_gate`로 미발행. Reel 시도 0·외부 ID 없음.
- [PR #181](https://github.com/betterbit-ai/today_econ/pull/181), main `0d0a42a2df556a2e2e31bab9ce92b8be0e34a980`: 제목에 명시된 일반 농지 사건의 주체를 농지로 보존하고 자체 생성 농지 자산 두 장을 연결했다. 다른 시장·정치의 잠긴 사건, 최근 이미지 중복 회피, 해시·주제별 두 변형·세로 규격 검사는 유지했다. 출처와 생성 프롬프트는 자산별 `.md`에 기록했다.

전체 harness 479건 중 478 통과·기존 1 skip·0 실패, diff check 통과. 최신 main 원장 통합 후 재검증도 통과했다. 독립 최종 리뷰 Green. 두 자산의 실제 1080×1920 표지 렌더에서 `overflow: false`를 확인하고 육안 검수했다. 이 표지 미리보기는 업로드하지 않았다.

## 배포 후 실발행 확인

[경제 38998569802](https://github.com/betterbit-ai/today_econ/actions/runs/38998569802)를 위 main SHA로 정상 `hot_news` 실행했다. 결과는 `no_candidate_passed_editorial_generation`·시도 0·외부 ID 없음이다. 새 현대차 조지아 투자 기사에서 숫자 의미 검사 실패 후 원고 재교정이 다른 숫자로 대체해 다시 실패했다. 아직 D0를 선언하지 않는다.

같은 기존 재교정 한도 안에서 숫자 근거 오류가 나면 allowedNumbers를 비우고 제목·본문 수치를 생략하도록 복구 지시를 보완했다. 원문 의미·기간·분모·비교·상태 검사는 그대로다. 일반 구조 오류는 원문의 허용 숫자 목록을 유지한다. 숫자를 제거한 모의 원고도 최종 검사를 통과하는 회귀와 기존 3년9개월·분모 보호를 포함해 검증했다. 전체 harness 481건 중 480 통과·기존 1 skip·0 실패 및 독립 리뷰 Green이다. 실제 모델의 숫자 생략 재교정 성공은 아래 실행에서 확인했다.

[PR #183](https://github.com/betterbit-ai/today_econ/pull/183), main `052666765466e0168853d4ac85554988b35df73d`로 숫자 재교정을 배포하고 [경제 38999083431](https://github.com/betterbit-ai/today_econ/actions/runs/38999083431)을 정상 실행했다. 결과는 실제 발행 성공이다. 2026-10-17 12:38:13 KST, media ID `17896337781413566`, [Reel](https://www.instagram.com/reel/DelKOm7DsrB/). 원장상 시사가 아닌 경제이며 제목은 `아크메르 동탄 / 견본주택 개관`이다. GPT-OSS-120B 첫 원고의 근거 없는 숫자 검사 실패 후 숫자 생략 재교정이 성공했다. 발행 시도 1회, 댓글·답글도 성공했고 feature schema3·전략v3·6초가 원장에 남았다.

**업로드는 복구됐지만 콘텐츠 품질 사고가 남아 D0는 보류한다.** 주택 견본주택 기사의 일반 frame 주체 `주거 정책`을 이미지 매핑이 housing으로 읽지 못하고 정책 키워드 때문에 legislation으로 보냈다. 실제 선택 자산 `legislation-01`을 열어 의사봉 그림임을 확인했다. 원장은 expectedTopic까지 같은 잘못된 매퍼에서 얻어 정상으로 표시했으므로 독립적인 의미 검증이 아니었다. 주택/법률 오매핑을 사고 fixture로 고정해 재발을 차단한다. 게시물 삭제·수정·재발행과 과거 원장 변환은 하지 않았다. 현재 제목의 독자 관심도와 홍보성 본문도 후속 편집 비교 대상이다.

시사 후보 부족은 인증 문제로 취급하지 않으며, 품질 gate를 낮추거나 같은 후보에 반복 실행하지 않는다. 기존 예약과 분야별 일일 1편 상한을 유지한다. Secret 장기 자동 연장과 후속 첫 화면·Basic 실험은 별도 미완료다.

## 주거 이미지 재발 방지 검증

잠긴 일반 주체가 정확히 `주거 정책`인 경우만 housing으로 연결하고 주택·아파트 검색어를 사용한다. 명시적 legislation/market_move 프레임은 유지한다. 실제 사고 replay는 housing과 주택 쿼리 두 개를 반환하고 legislation-01 강제 선택은 null이다. 실패를 먼저 재현한 두 회귀 후 전체 harness 483건 중 482 통과·기존1 skip·0실패, diff check 및 독립 리뷰 Green이다. 과거 잘못된 이미지 원장과 게시물은 그대로 보존했다. 다음 실제 결과의 주제·제목 품질 확인 전 콘텐츠 복구를 완료로 표시하지 않는다.

[Claude Pro 도입 검토안](2026-10-17-claude-pro-editorial-review.md)은 별도 제안이다. Claude 설치·토큰 발급·실제 모델 비교·자동 운영 전환은 아직 하지 않았다.
