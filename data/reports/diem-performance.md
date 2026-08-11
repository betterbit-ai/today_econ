# DIEM 지속 성과 리포트

- 상태: ready
- 발행 원장 Reel: 77편
- 생성 시각: 2026-08-11T14:56:15.379Z
- 원칙: 24h, 72h, 7d 지표를 섞지 않고 카테고리별 표본 5편 이상에서만 패턴을 학습합니다.

## 24h
- economy: 표본 27편 · 노출 중앙값 1,317 · 공유율 0.11% · 저장률 0%
  - 반복 후보: 이재명 / ISA 개편 중단(722,042), 이재명 대통령 / 휴가 권고(126,069), 청년 퇴사 / 실업급여 추진(3,284), 두산 SK실트론 인수 / 계획 확정(2,435), 보유세 개편 / 결정(2,297)
  - 부진 후보: 미국 2분기 성장률 / 1.5% 둔화(150), 미·일 환율 개입 / 잠정(161), 코스피 16% 폭락 / 개인투자자 절망 시대(161), 전직 교육인, 반도체 300% 수익 / 핵심 비법(173), 미니 드라이버 / 기아 에어백(177)
  - 특성 신호: event:interest_rate insufficient_data×0.92, company_event underperformer×0.28, event:ipo underperformer×0.28, event:semiconductor underperformer×0.2, market_shock underperformer×0.17, macro_indicator underperformer×0.12
- issue: 표본 31편 · 노출 중앙값 1,537 · 공유율 0.12% · 저장률 0%
  - 반복 후보: 태국 총리 / 러시아 살해 사과(23,299), 바이든 암 / 전이 확인(21,254), 국방부 / 1군단장 직무배제(18,351), 태풍 돌핀 / 한반도 영향예상(11,389)
  - 부진 후보: 서울 폭염 / 37도 예보(154), 보완수사권 폐지 / 국회 본회의 완전 통과(207), 이재명 대통령 / 지지율 53% 최저 기록(256), 대구 폭염 / 40.9도(272), 청도군 물단수 / 예정 발표(292)
  - 특성 신호: housing_money insufficient_data×0.7, public_decision underperformer×0.33, event:housing_policy insufficient_data×0.33, event:legislation underperformer×0.31, household_money insufficient_data×0.3, work_life insufficient_data×0.2

## 72h
- economy: 표본 24편 · 노출 중앙값 1,112.5 · 공유율 0.13% · 저장률 0%
  - 반복 후보: 이재명 대통령 / 휴가 권고(126,069), 청년 퇴사 / 실업급여 추진(3,284), 두산 SK실트론 인수 / 계획 확정(2,435), 보유세 개편 / 결정(2,297), 대출 규제 / 계약 포기 급증(2,267)
  - 부진 후보: 미국 2분기 성장률 / 1.5% 둔화(150), 미·일 환율 개입 / 잠정(161), 코스피 16% 폭락 / 개인투자자 절망 시대(161), 전직 교육인, 반도체 300% 수익 / 핵심 비법(173), 미니 드라이버 / 기아 에어백(177)
  - 특성 신호: household_money winner×1.4, housing_money winner×1.4, event:housing_policy winner×1.36, public_decision winner×1.36, event:interest_rate insufficient_data×1.09, company_event underperformer×0.28, event:ipo insufficient_data×0.26, event:semiconductor underperformer×0.23
- issue: 표본 25편 · 노출 중앙값 1,296 · 공유율 0.16% · 저장률 0%
  - 반복 후보: 태국 총리 / 러시아 살해 사과(23,299), 국방부 / 1군단장 직무배제(18,351), 태풍 돌핀 / 한반도 영향예상(11,389), 청와대, 보완수사권 폐지 / 국회 판단 존중(2,063), 냉풍기 / 퇴출위기(1,988)
  - 부진 후보: 서울 폭염 / 37도 예보(154), 보완수사권 폐지 / 국회 본회의 완전 통과(207), 이재명 대통령 / 지지율 53% 최저 기록(256), 대구 폭염 / 40.9도(272), 청도군 물단수 / 예정 발표(292)
  - 특성 신호: housing_money insufficient_data×0.83, event:housing_policy insufficient_data×0.39, public_decision underperformer×0.38, event:legislation underperformer×0.36, household_money insufficient_data×0.36, work_life insufficient_data×0.24

## 7d
- economy: 표본 16편 · 노출 중앙값 314.5 · 공유율 0.06% · 저장률 0%
  - 반복 후보: 두산 SK실트론 인수 / 계획 확정(2,435), 한국 반도체 1위 유지 / 배터리·조선 중국 추격(2,172), 비거주 1주택 / 종부세 4배(1,779), 강남 고령층 / 세제개편 압박(1,556), 정부 세제개편 / 1주택 보호(1,519)
  - 부진 후보: 미국 2분기 성장률 / 1.5% 둔화(150)
  - 특성 신호: housing_money winner×4.89, event:housing_policy winner×4.83, household_money winner×4.76, public_decision winner×4.59, work_life winner×4.57, event:general insufficient_data×2.55, event:ipo insufficient_data×0.91, event:interest_rate insufficient_data×0.51
- issue: 표본 12편 · 노출 중앙값 1,047 · 공유율 0.28% · 저장률 0%
  - 반복 후보: 태국 총리 / 러시아 살해 사과(23,299), 국방부 / 1군단장 직무배제(18,351), 태풍 돌핀 / 한반도 영향예상(11,389), 청와대, 보완수사권 폐지 / 국회 판단 존중(2,063), 포켓몬 카드 220억 거래 / 일본 규제 움직임(1,693)
  - 부진 후보: 서울 폭염 / 37도 예보(154), 보완수사권 폐지 / 국회 본회의 완전 통과(207), 이재명 대통령 / 지지율 53% 최저 기록(256), 대구 폭염 / 40.9도(272), 청도군 물단수 / 예정 발표(292)
  - 특성 신호: public_decision underperformer×0.44, event:general underperformer×0.44, household_money insufficient_data×0.44, housing_money insufficient_data×0.24

## 이미지·음악 운영
- 타이포그래피 폴백률: 25.97%
- 이미지 공급원: pexels 50편, diem-original 20편, unsplash 4편, wikimedia 3편
- 음악: 현재 20% 초과 단일 트랙 편중 경고 없음
- 음악 판단 원칙: 한 트랙 사용률이 20%를 넘거나 충분한 표본에서 반복 피로가 확인될 때만 음원을 추가합니다.
- 편집 후보 실패: unknown 44건, editorial_generation_failed 19건
- 제목 재정제 실패: 0건

## 해석 주의
- 한 건의 바이럴이나 부진으로 주제를 금지하지 않습니다. 표본 하한과 중앙값을 함께 봅니다.
- 도달은 발견 가능성, 공유·저장은 효용, 팔로워 증분은 계정 단위 추정치로 분리해 해석합니다.
