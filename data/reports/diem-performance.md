# DIEM 지속 성과 리포트

- 상태: ready
- 발행 원장 Reel: 278편
- 생성 시각: 2026-10-13T11:27:09.730Z
- 원칙: 24h, 72h, 7d 지표를 섞지 않고 feature schema v2 카테고리별 10편, 특성별 5편 이상에서만 패턴을 학습합니다.

## 24h
- economy: 표본 89편 · 노출 중앙값 203 · 공유율 0% · 저장률 0%
  - 반복 후보: 비거주1주택 / 징벌과세 결정(91,127), 공무원 / 광고 사과(4,413), 백악관 경고 / 중국 환적 우려(2,226), 미국 관세 압박 / 한국 대응(2,018), 김민석 / 압승 확정(1,969)
  - 특성 신호: market_shock insufficient_data×9.62, event:housing_policy insufficient_data×5.27, reader_need:work insufficient_data×1.33, work_life insufficient_data×1.33, housing_money insufficient_data×1.13, event:semiconductor insufficient_data×1.04, reader_need:market insufficient_data×1.04, household_money insufficient_data×0.96
- issue: 표본 99편 · 노출 중앙값 290 · 공유율 0% · 저장률 0%
  - 반복 후보: 주진우 증언 / 우원식표결지연(23,904), 선관위 / 서울시장 소청 기각(7,617), 북 미사일 발사 / 김여정 조롱(5,362), 한동훈 흉기 / 징역 1년 확정(3,867), 트럼프 분노 / 한국 희생양(3,691)
  - 부진 후보: 모기 활동 / 주의 권고(24), 이재명 대통령 / 검찰개혁 발언(36), 박선원 공개 / 공익제보자 위반(40), 지뢰조사 지연 / 정치 대립(42), 배현진 비판 / 이재명 물(46)
  - 특성 신호: company_event insufficient_data×6.85, event:political_statement insufficient_data×4.03, event:semiconductor insufficient_data×0.97, reader_need:market insufficient_data×0.97, household_money insufficient_data×0.88, reader_need:household_cost insufficient_data×0.88
- 정시 비교에서 제외한 늦은 백필: 90편

## 72h
- economy: 표본 91편 · 노출 중앙값 220 · 공유율 0% · 저장률 0%
  - 반복 후보: 이재명 / ISA 개편 중단(722,599), 비거주1주택 / 징벌과세 결정(148,114), 공무원 / 광고 사과(4,641), 보유세 개편 / 결정(2,297), 백악관 경고 / 중국 환적 우려(2,251)
  - 특성 신호: market_shock insufficient_data×8.89, event:housing_policy insufficient_data×4.88, public_decision insufficient_data×3.22, reader_need:work insufficient_data×1.21, work_life insufficient_data×1.21, housing_money insufficient_data×1.06, household_money insufficient_data×1.03, event:semiconductor insufficient_data×0.97
- issue: 표본 104편 · 노출 중앙값 346.5 · 공유율 0% · 저장률 0%
- 정시 비교에서 제외한 늦은 백필: 79편

## 7d
- economy: 표본 99편 · 노출 중앙값 239 · 공유율 0% · 저장률 0%
- issue: 표본 114편 · 노출 중앙값 453.5 · 공유율 0% · 저장률 0%
- 정시 비교에서 제외한 늦은 백필: 42편

## 이미지·음악 운영
- 계정 팔로워 순변화: 33 (중복 제거 스냅샷 217개; 게시물별 추정치 합산 금지)
- 타이포그래피 폴백률: 15.11%
- 생성 배경 폴백률: 45.68% · 전체 폴백률: 60.79%
- 이미지 공급원: diem-generated 127편, pexels 98편, diem-original 42편, unsplash 6편, wikimedia 4편, openverse 1편
- 최근 7일 폴백률: 100% (12/12편, 2026-10-07~2026-10-13)
- 최근 7일 Vision 실패: model_error 7건
- 음악: 현재 20% 초과 단일 트랙 편중 경고 없음
- 음악 판단 원칙: 한 트랙 사용률이 20%를 넘거나 충분한 표본에서 반복 피로가 확인될 때만 음원을 추가합니다.
- 편집 후보 실패: editorial_generation_failed 147건, image_context_unavailable 104건, unknown 44건
- 제목 재정제 실패: 42건

## 해석 주의
- 한 건의 바이럴이나 부진으로 주제를 금지하지 않습니다. 표본 하한과 중앙값을 함께 봅니다.
- 도달은 발견 가능성, 공유·저장은 효용, 팔로워 증분은 계정 단위 추정치로 분리해 해석합니다.
