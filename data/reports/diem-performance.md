# DIEM 지속 성과 리포트

- 상태: ready
- 발행 원장 Reel: 300편
- 생성 시각: 2026-10-30T10:46:15.759Z
- 원칙: 24h, 72h, 7d 지표를 섞지 않고 reach를 대표 성과로 고정하며 feature schema v3 카테고리별 10편, 특성별 5편 이상에서만 패턴을 학습합니다.
- 최종 목표 판정: not_achieved

## 24h
- economy: 표본 95편 · reach 중앙값 159 · 시청 비율 47.48% · 공유율 0% · 저장률 0%
  - 반복 후보: 비거주1주택 / 징벌과세 결정(48,589), 공무원 / 광고 사과(2,549), 백악관 경고 / 중국 환적 우려(1,584), 외국인 난투극 / 경찰 체포·추적(1,430), 미국 관세 압박 / 한국 대응(1,380)
  - 특성 신호: event:semiconductor insufficient_data×3.42, reader_need:household_cost insufficient_data×2.16, event:housing_policy insufficient_data×1.07, housing_money insufficient_data×1.05, reader_need:housing insufficient_data×1.05, work_life insufficient_data×0.99, reader_need:public_interest insufficient_data×0.99, reader_need:tax insufficient_data×0.98
- issue: 표본 114편 · reach 중앙값 208 · 시청 비율 50.75% · 공유율 0% · 저장률 0%
  - 반복 후보: 주진우 증언 / 우원식표결지연(12,743), 선관위 / 서울시장 소청 기각(4,775), 북 미사일 발사 / 김여정 조롱(3,258), 한동훈 흉기 / 징역 1년 확정(2,700), 트럼프 분노 / 한국 희생양(2,363)
  - 부진 후보: 이재명 대통령 / 검찰개혁 발언(20), 모기 활동 / 주의 권고(22), 박선원 공개 / 공익제보자 위반(29), 지뢰조사 지연 / 정치 대립(34), 송지은 눈물 / 새롭게하소서(36)
  - 특성 신호: reader_need:market insufficient_data×8.45, reader_need:housing insufficient_data×4.7, household_money insufficient_data×0.92
- 정시 비교에서 제외한 늦은 백필: 90편
- 포맷 코호트: unknown 161편/reach 192 · flash 43편/reach 139 · explain 5편/reach 191
- 이미지 코호트: web 65편/reach 481 · other 15편/reach 1,105 · library 129편/reach 157
- 전략 코호트: legacy 184편 · discovery-funnel-v3 25편

## 72h
- economy: 표본 96편 · reach 중앙값 169 · 시청 비율 47.27% · 공유율 0% · 저장률 0%
- issue: 표본 118편 · reach 중앙값 256.5 · 시청 비율 49.88% · 공유율 0% · 저장률 0%
  - 반복 후보: 주진우 증언 / 우원식표결지연(17,190), 바이든 암 / 전이 확인(13,132), 선관위 / 서울시장 소청 기각(4,869), 북 미사일 발사 / 김여정 조롱(3,277), 한동훈 흉기 / 징역 1년 확정(2,761)
  - 부진 후보: 이재명 대통령 / 검찰개혁 발언(23), 모기 활동 / 주의 권고(24), 박선원 공개 / 공익제보자 위반(33), 배현진 비판 / 이재명 물(39), 송지은 눈물 / 새롭게하소서(42)
  - 특성 신호: reader_need:market insufficient_data×8.79, reader_need:housing insufficient_data×8.69, household_money insufficient_data×0.98
- 정시 비교에서 제외한 늦은 백필: 79편
- 포맷 코호트: unknown 172편/reach 228.5 · flash 37편/reach 145 · explain 5편/reach 200
- 이미지 코호트: web 69편/reach 1,081 · other 18편/reach 1,183 · library 127편/reach 161
- 전략 코호트: legacy 193편 · discovery-funnel-v3 21편

## 7d
- economy: 표본 105편 · reach 중앙값 181 · 시청 비율 44.4% · 공유율 0% · 저장률 0%
- issue: 표본 124편 · reach 중앙값 335 · 시청 비율 51.59% · 공유율 0% · 저장률 0%
- 정시 비교에서 제외한 늦은 백필: 42편
- 포맷 코호트: unknown 198편/reach 289.5 · flash 28편/reach 150 · explain 3편/reach 1,122
- 이미지 코호트: other 22편/reach 1,206.5 · web 83편/reach 1,089 · library 124편/reach 162.5
- 전략 코호트: legacy 217편 · discovery-funnel-v3 12편

## 이미지·음악 운영
- 최근 14일 계정 팔로워 순변화: 3 (중복 제거 스냅샷 37개; 게시물별 추정치 합산 금지)
- 타이포그래피 폴백률: 12.67%
- 생성 배경 폴백률: 45.67% · 전체 폴백률: 58.33%
- 이미지 공급원: diem-generated 137편, pexels 110편, diem-original 38편, unsplash 9편, wikimedia 5편, openverse 1편
- 최근 7일 폴백률: 28.57% (4/14편, 2026-10-24~2026-10-30)
- 최근 7일 Vision 실패: budget_exhausted 8건, context_rejected 2건, model_error 2건
- 음악: 현재 20% 초과 단일 트랙 편중 경고 없음
- 음악 판단 원칙: 한 트랙 사용률이 20%를 넘거나 충분한 표본에서 반복 피로가 확인될 때만 음원을 추가합니다.
- 편집 후보 실패: editorial_generation_failed 192건, image_context_unavailable 140건, unknown 44건
- 제목 재정제 실패: 49건

## 해석 주의
- 한 건의 바이럴이나 부진으로 주제를 금지하지 않습니다. 표본 하한과 중앙값을 함께 봅니다.
- 도달은 발견 가능성, 공유·저장은 효용, 팔로워 증분은 계정 단위 추정치로 분리해 해석합니다.
