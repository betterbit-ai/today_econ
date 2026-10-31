# DIEM 지속 성과 리포트

- 상태: ready
- 발행 원장 Reel: 303편
- 생성 시각: 2026-10-31T19:49:12.523Z
- 원칙: 24h, 72h, 7d 지표를 섞지 않고 reach를 대표 성과로 고정하며 feature schema v3 카테고리별 10편, 특성별 5편 이상에서만 패턴을 학습합니다.
- 최종 목표 판정: not_achieved

## 24h
- economy: 표본 96편 · reach 중앙값 159 · 시청 비율 46.6% · 공유율 0% · 저장률 0%
  - 반복 후보: 비거주1주택 / 징벌과세 결정(48,589), 공무원 / 광고 사과(2,549), 백악관 경고 / 중국 환적 우려(1,584), 외국인 난투극 / 경찰 체포·추적(1,430), 미국 관세 압박 / 한국 대응(1,380)
  - 특성 신호: reader_need:household_cost insufficient_data×2.18, event:semiconductor insufficient_data×2.16, event:housing_policy insufficient_data×1.08, housing_money insufficient_data×1.05, reader_need:housing insufficient_data×1.05, work_life insufficient_data×1, reader_need:public_interest insufficient_data×1, reader_need:tax insufficient_data×0.98
- issue: 표본 114편 · reach 중앙값 208 · 시청 비율 50.75% · 공유율 0% · 저장률 0%
  - 반복 후보: 주진우 증언 / 우원식표결지연(12,743), 선관위 / 서울시장 소청 기각(4,775), 북 미사일 발사 / 김여정 조롱(3,258), 한동훈 흉기 / 징역 1년 확정(2,700), 트럼프 분노 / 한국 희생양(2,363)
  - 부진 후보: 이재명 대통령 / 검찰개혁 발언(20), 모기 활동 / 주의 권고(22), 박선원 공개 / 공익제보자 위반(29), 지뢰조사 지연 / 정치 대립(34), 송지은 눈물 / 새롭게하소서(36)
  - 특성 신호: reader_need:market insufficient_data×8.45, reader_need:housing insufficient_data×4.7, household_money insufficient_data×0.92
- 정시 비교에서 제외한 늦은 백필: 90편
- 포맷 코호트: unknown 161편/reach 192 · flash 44편/reach 137.5 · explain 5편/reach 191
- 이미지 코호트: web 65편/reach 481 · other 15편/reach 1,105 · library 130편/reach 156.5
- 전략 코호트: legacy 184편 · discovery-funnel-v3 26편

## 72h
- economy: 표본 97편 · reach 중앙값 168 · 시청 비율 48.37% · 공유율 0% · 저장률 0%
- issue: 표본 120편 · reach 중앙값 247 · 시청 비율 49.88% · 공유율 0% · 저장률 0%
  - 반복 후보: 주진우 증언 / 우원식표결지연(17,190), 바이든 암 / 전이 확인(13,132), 선관위 / 서울시장 소청 기각(4,869), 북 미사일 발사 / 김여정 조롱(3,277), 한동훈 흉기 / 징역 1년 확정(2,761)
  - 부진 후보: 이재명 대통령 / 검찰개혁 발언(23), 모기 활동 / 주의 권고(24), 박선원 공개 / 공익제보자 위반(33), 배현진 비판 / 이재명 물(39), 송지은 눈물 / 새롭게하소서(42)
  - 특성 신호: reader_need:market insufficient_data×7.72, reader_need:housing insufficient_data×4.32, household_money insufficient_data×0.86
- 정시 비교에서 제외한 늦은 백필: 79편
- 포맷 코호트: unknown 172편/reach 228.5 · flash 40편/reach 145.5 · explain 5편/reach 200
- 이미지 코호트: web 72편/reach 918.5 · other 18편/reach 1,183 · library 127편/reach 161
- 전략 코호트: legacy 193편 · discovery-funnel-v3 24편

## 7d
- economy: 표본 106편 · reach 중앙값 179 · 시청 비율 46.1% · 공유율 0% · 저장률 0%
- issue: 표본 125편 · reach 중앙값 321 · 시청 비율 45.78% · 공유율 0% · 저장률 0%
- 정시 비교에서 제외한 늦은 백필: 42편
- 포맷 코호트: unknown 198편/reach 289.5 · flash 30편/reach 148.5 · explain 3편/reach 1,122
- 이미지 코호트: other 22편/reach 1,206.5 · web 85편/reach 1,086 · library 124편/reach 162.5
- 전략 코호트: legacy 217편 · discovery-funnel-v3 14편

## 이미지·음악 운영
- 최근 14일 계정 팔로워 순변화: 4 (중복 제거 스냅샷 37개; 게시물별 추정치 합산 금지)
- 타이포그래피 폴백률: 12.54%
- 생성 배경 폴백률: 45.87% · 전체 폴백률: 58.42%
- 이미지 공급원: diem-generated 139편, pexels 110편, diem-original 38편, unsplash 10편, wikimedia 5편, openverse 1편
- 최근 7일 폴백률: 46.15% (6/13편, 2026-10-26~2026-11-01)
- 최근 7일 Vision 실패: budget_exhausted 11건, context_rejected 3건, model_error 3건
- 음악: 현재 20% 초과 단일 트랙 편중 경고 없음
- 음악 판단 원칙: 한 트랙 사용률이 20%를 넘거나 충분한 표본에서 반복 피로가 확인될 때만 음원을 추가합니다.
- 편집 후보 실패: editorial_generation_failed 192건, image_context_unavailable 142건, unknown 44건
- 제목 재정제 실패: 49건

## 해석 주의
- 한 건의 바이럴이나 부진으로 주제를 금지하지 않습니다. 표본 하한과 중앙값을 함께 봅니다.
- 도달은 발견 가능성, 공유·저장은 효용, 팔로워 증분은 계정 단위 추정치로 분리해 해석합니다.
