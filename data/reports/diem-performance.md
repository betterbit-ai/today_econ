# DIEM 지속 성과 리포트

- 상태: ready
- 발행 원장 Reel: 92편
- 생성 시각: 2026-08-14T05:33:27.164Z
- 원칙: 24h, 72h, 7d 지표를 섞지 않고 카테고리별 표본 5편 이상에서만 패턴을 학습합니다.

## 24h
- economy: 표본 5편 · 노출 중앙값 702 · 공유율 0.17% · 저장률 0%
  - 반복 후보: 고가 주택 / 교환 매매 부상(1,526)
  - 특성 신호: household_money insufficient_data×2.17, event:housing_policy insufficient_data×1.59, housing_money insufficient_data×1.59, company_event insufficient_data×1.11, event:ipo insufficient_data×1.11, event:general insufficient_data×0.66
- issue: 표본 7편 · 노출 중앙값 3,187 · 공유율 0.09% · 저장률 0%
  - 반복 후보: 주진우 증언 / 우원식표결지연(23,904), 선관위 / 서울시장 소청 기각(7,617)
  - 부진 후보: 대전시 / 공공기관2차선점전(460), 강남산부인과원장 / 프로포몰투약(1,504)
  - 특성 신호: public_decision winner×1.8, event:housing_policy insufficient_data×1.21, housing_money insufficient_data×0.51
- 정시 비교에서 제외한 늦은 백필: 72편

## 72h
- economy: 표본 6편 · 노출 중앙값 1,064 · 공유율 0.04% · 저장률 0.06%
  - 반복 후보: 이재명 / ISA 개편 중단(722,599), 보유세 개편 / 결정(2,297)
  - 특성 신호: household_money insufficient_data×2.16, event:housing_policy insufficient_data×1.42, housing_money insufficient_data×1.42, public_decision winner×1.42, company_event insufficient_data×0.75, event:ipo insufficient_data×0.75
- issue: 표본 9편 · 노출 중앙값 1,616 · 공유율 0.09% · 저장률 0%
  - 반복 후보: 바이든 암 / 전이 확인(21,336), 새벽 19도 / 13·15호(3,267)
  - 특성 신호: public_decision insufficient_data×13.2, housing_money insufficient_data×1.17
- 정시 비교에서 제외한 늦은 백필: 60편

## 7d
- economy: 표본 10편 · 노출 중앙값 1,482 · 공유율 0.18% · 저장률 0.09%
  - 반복 후보: 이재명 대통령 / 휴가 권고(126,102), 청년 퇴사 / 실업급여 추진(3,285), 대출 규제 / 계약 포기 급증(2,268)
  - 부진 후보: 생산적 ISA / 정책 개편(395)
  - 특성 신호: work_life winner×1.6, event:interest_rate insufficient_data×1.53, macro_indicator insufficient_data×1.53
- issue: 표본 11편 · 노출 중앙값 1,630 · 공유율 0.12% · 저장률 0%
  - 반복 후보: 국방부 / 1군단장 직무배제(18,351), 태풍 돌핀 / 한반도 영향예상(11,389)
  - 부진 후보: 형사소송법 / 보완수사권폐지(444), 형사소송법 개정 / 보완권 폐지(478), 청년 청소 / 삶 회복(514)
  - 특성 신호: public_decision underperformer×0.32, event:housing_policy insufficient_data×0.32, event:legislation underperformer×0.29
- 정시 비교에서 제외한 늦은 백필: 29편

## 이미지·음악 운영
- 타이포그래피 폴백률: 25%
- 이미지 공급원: pexels 62편, diem-original 23편, unsplash 4편, wikimedia 3편
- 음악: 현재 20% 초과 단일 트랙 편중 경고 없음
- 음악 판단 원칙: 한 트랙 사용률이 20%를 넘거나 충분한 표본에서 반복 피로가 확인될 때만 음원을 추가합니다.
- 편집 후보 실패: unknown 44건, editorial_generation_failed 27건
- 제목 재정제 실패: 0건

## 해석 주의
- 한 건의 바이럴이나 부진으로 주제를 금지하지 않습니다. 표본 하한과 중앙값을 함께 봅니다.
- 도달은 발견 가능성, 공유·저장은 효용, 팔로워 증분은 계정 단위 추정치로 분리해 해석합니다.
