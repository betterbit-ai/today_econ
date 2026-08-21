# DIEM 지속 성과 리포트

- 상태: ready
- 발행 원장 Reel: 135편
- 생성 시각: 2026-08-21T22:24:36.155Z
- 원칙: 24h, 72h, 7d 지표를 섞지 않고 카테고리별 표본 5편 이상에서만 패턴을 학습합니다.

## 24h
- economy: 표본 22편 · 노출 중앙값 1,040 · 공유율 0.03% · 저장률 0%
  - 반복 후보: 비거주1주택 / 징벌과세 결정(91,127), 공무원 / 광고 사과(4,413), 백악관 경고 / 중국 환적 우려(2,226), 미국 관세 압박 / 한국 대응(2,018), 김민석 / 압승 확정(1,969)
  - 부진 후보: 주차 로봇 / 아파트 도입(145), 통영 폭우 / 도로·공장 붕괴(158), 서초·강남 / 2주 연속 하락(167), 일본 기업 / 정년 65세 연장(339), ISA 세금 / 줄이는 방식(341)
  - 특성 신호: event:semiconductor insufficient_data×2.02, event:interest_rate insufficient_data×1.46, macro_indicator insufficient_data×1.46, work_life insufficient_data×0.99, event:ipo insufficient_data×0.75, event:general underperformer×0.68, company_event insufficient_data×0.54, household_money underperformer×0.33
- issue: 표본 25편 · 노출 중앙값 1,610 · 공유율 0.09% · 저장률 0%
  - 반복 후보: 주진우 증언 / 우원식표결지연(23,904), 선관위 / 서울시장 소청 기각(7,617), 북 미사일 발사 / 김여정 조롱(5,362), 한동훈 흉기 / 징역 1년 확정(3,867), 트럼프 분노 / 한국 희생양(3,691)
  - 부진 후보: 광복연휴 비예보 / 폭염 예상(173), 백화점 난동 / 5년 형 선고(189), 롤스로이스 / 주차 빌런 보도(456), 대전시 / 공공기관2차선점전(460)
  - 특성 신호: event:housing_policy insufficient_data×1.68, market_shock insufficient_data×0.92
- 정시 비교에서 제외한 늦은 백필: 79편

## 72h
- economy: 표본 22편 · 노출 중앙값 1,450.5 · 공유율 0.09% · 저장률 0.02%
  - 반복 후보: 이재명 / ISA 개편 중단(722,599), 비거주1주택 / 징벌과세 결정(148,114), 공무원 / 광고 사과(4,641), 보유세 개편 / 결정(2,297), 백악관 경고 / 중국 환적 우려(2,251)
  - 부진 후보: 통영 폭우 / 도로·공장 붕괴(162), ISA 세금 / 줄이는 방식(358), ISA 개편 / 복원안 발표(383), 거제 폭우 / 복구 진행(492), 이만희 재판 / 합의부 재배당(573)
  - 특성 신호: event:semiconductor insufficient_data×1.46, work_life insufficient_data×1.21, event:interest_rate insufficient_data×1.05, macro_indicator insufficient_data×1.05, company_event insufficient_data×0.55, event:ipo insufficient_data×0.55
- issue: 표본 27편 · 노출 중앙값 1,646 · 공유율 0.09% · 저장률 0%
  - 반복 후보: 주진우 증언 / 우원식표결지연(32,963), 바이든 암 / 전이 확인(21,336), 선관위 / 서울시장 소청 기각(7,810), 한동훈 흉기 / 징역 1년 확정(3,959), 새벽 19도 / 13·15호(3,267)
  - 부진 후보: 광복연휴 비예보 / 폭염 예상(176), 백화점 난동 / 5년 형 선고(199), 롤스로이스 / 주차 빌런 보도(461), 대전시 / 공공기관2차선점전(479)
  - 특성 신호: event:housing_policy insufficient_data×1.68
- 정시 비교에서 제외한 늦은 백필: 67편

## 7d
- economy: 표본 24편 · 노출 중앙값 1,482 · 공유율 0.17% · 저장률 0.09%
  - 반복 후보: 이재명 / ISA 개편 중단(730,307), 이재명 대통령 / 휴가 권고(126,102), 공무원 / 광고 사과(4,696), 청년 퇴사 / 실업급여 추진(3,285), 보유세 개편 / 결정(2,313)
  - 부진 후보: 미니 드라이버 / 기아 에어백(183), ISA 개편 / 복원안 발표(390), 생산적 ISA / 정책 개편(395), 이만희 재판 / 합의부 재배당(579), 콜롬비아 지진 / 비상사태 선포(727)
  - 특성 신호: work_life winner×1.6, event:semiconductor insufficient_data×1.52, event:interest_rate insufficient_data×1.28, macro_indicator insufficient_data×1.28, company_event insufficient_data×0.54, event:ipo insufficient_data×0.54
- issue: 표본 33편 · 노출 중앙값 1,630 · 공유율 0.09% · 저장률 0%
  - 반복 후보: 주진우 증언 / 우원식표결지연(38,433), 바이든 암 / 전이 확인(21,605), 국방부 / 1군단장 직무배제(18,351), 태풍 돌핀 / 한반도 영향예상(11,389), 선관위 / 서울시장 소청 기각(7,870)
  - 부진 후보: 광복연휴 비예보 / 폭염 예상(180), 이주노동자 / 폭염 작업(314), 세종시 환경원 / 트럭 가득(428), 형사소송법 / 보완수사권폐지(444), 형사소송법 개정 / 보완권 폐지(478)
  - 특성 신호: event:housing_policy insufficient_data×1.37, housing_money insufficient_data×1.08, event:legislation underperformer×0.29, work_life insufficient_data×0.19
- 정시 비교에서 제외한 늦은 백필: 31편

## 이미지·음악 운영
- 타이포그래피 폴백률: 26.67%
- 이미지 공급원: pexels 89편, diem-original 36편, unsplash 6편, wikimedia 4편
- 음악: 현재 20% 초과 단일 트랙 편중 경고 없음
- 음악 판단 원칙: 한 트랙 사용률이 20%를 넘거나 충분한 표본에서 반복 피로가 확인될 때만 음원을 추가합니다.
- 편집 후보 실패: editorial_generation_failed 48건, unknown 44건
- 제목 재정제 실패: 1건

## 해석 주의
- 한 건의 바이럴이나 부진으로 주제를 금지하지 않습니다. 표본 하한과 중앙값을 함께 봅니다.
- 도달은 발견 가능성, 공유·저장은 효용, 팔로워 증분은 계정 단위 추정치로 분리해 해석합니다.
