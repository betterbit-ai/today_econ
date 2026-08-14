# DIEM 지속 성과 리포트

- 상태: ready
- 발행 원장 Reel: 94편
- 생성 시각: 2026-08-14T11:01:42.239Z
- 원칙: 24h, 72h, 7d 지표를 섞지 않고 카테고리별 표본 5편 이상에서만 패턴을 학습합니다.

## 24h
- economy: 표본 6편 · 노출 중앙값 742.5 · 공유율 0.09% · 저장률 0%
  - 반복 후보: 고가 주택 / 교환 매매 부상(1,526), 국토부 / 주택 23만 공급(1,330)
  - 부진 후보: ISA 개편 / 복원안 발표(365)
  - 특성 신호: household_money insufficient_data×2.06, event:housing_policy winner×1.79, housing_money winner×1.79, company_event insufficient_data×1.05, event:ipo insufficient_data×1.05, event:general insufficient_data×0.62
- issue: 표본 8편 · 노출 중앙값 2,412.5 · 공유율 0.04% · 저장률 0%
  - 반복 후보: 주진우 증언 / 우원식표결지연(23,904), 선관위 / 서울시장 소청 기각(7,617), 한동훈 흉기 / 징역 1년 확정(3,867)
  - 부진 후보: 광복연휴 비예보 / 폭염 예상(173), 대전시 / 공공기관2차선점전(460)
  - 특성 신호: public_decision winner×2.38, event:housing_policy insufficient_data×1.6, event:general underperformer×0.68, housing_money insufficient_data×0.68
- 정시 비교에서 제외한 늦은 백필: 72편

## 72h
- economy: 표본 6편 · 노출 중앙값 1,064 · 공유율 0.04% · 저장률 0.06%
  - 반복 후보: 이재명 / ISA 개편 중단(722,599), 보유세 개편 / 결정(2,297)
  - 특성 신호: household_money insufficient_data×2.16, event:housing_policy insufficient_data×1.42, housing_money insufficient_data×1.42, public_decision winner×1.42, company_event insufficient_data×0.75, event:ipo insufficient_data×0.75
- issue: 표본 10편 · 노출 중앙값 1,751.5 · 공유율 0.09% · 저장률 0%
  - 반복 후보: 바이든 암 / 전이 확인(21,336), 한동훈 흉기 / 징역 1년 확정(3,959), 새벽 19도 / 13·15호(3,267)
  - 특성 신호: public_decision insufficient_data×7.22, event:housing_policy insufficient_data×2.26, housing_money insufficient_data×1.08
- 정시 비교에서 제외한 늦은 백필: 60편

## 7d
- economy: 표본 11편 · 노출 중앙값 1,445 · 공유율 0.18% · 저장률 0.09%
  - 반복 후보: 이재명 대통령 / 휴가 권고(126,102), 청년 퇴사 / 실업급여 추진(3,285), 대출 규제 / 계약 포기 급증(2,268)
  - 부진 후보: 미니 드라이버 / 기아 에어백(183), 생산적 ISA / 정책 개편(395)
  - 특성 신호: work_life winner×1.64, event:interest_rate insufficient_data×1.57, macro_indicator insufficient_data×1.57
- issue: 표본 12편 · 노출 중앙값 1,463 · 공유율 0.1% · 저장률 0%
  - 반복 후보: 국방부 / 1군단장 직무배제(18,351), 태풍 돌핀 / 한반도 영향예상(11,389)
  - 부진 후보: 이주노동자 / 폭염 작업(314), 형사소송법 / 보완수사권폐지(444), 형사소송법 개정 / 보완권 폐지(478), 청년 청소 / 삶 회복(514)
  - 특성 신호: public_decision underperformer×0.35, event:housing_policy insufficient_data×0.35, event:legislation underperformer×0.33, work_life insufficient_data×0.21
- 정시 비교에서 제외한 늦은 백필: 29편

## 이미지·음악 운영
- 타이포그래피 폴백률: 25.53%
- 이미지 공급원: pexels 63편, diem-original 24편, unsplash 4편, wikimedia 3편
- 음악: 현재 20% 초과 단일 트랙 편중 경고 없음
- 음악 판단 원칙: 한 트랙 사용률이 20%를 넘거나 충분한 표본에서 반복 피로가 확인될 때만 음원을 추가합니다.
- 편집 후보 실패: unknown 44건, editorial_generation_failed 27건
- 제목 재정제 실패: 0건

## 해석 주의
- 한 건의 바이럴이나 부진으로 주제를 금지하지 않습니다. 표본 하한과 중앙값을 함께 봅니다.
- 도달은 발견 가능성, 공유·저장은 효용, 팔로워 증분은 계정 단위 추정치로 분리해 해석합니다.
