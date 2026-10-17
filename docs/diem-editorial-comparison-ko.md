# DIEM 원고 모델 비교 사용 안내

경제 Actions에서 `compare_editorial`을 실행하면 같은 원문으로 GPT-OSS-120B와 Sonnet 5.5를 비교한다. 이 작업은 게시물·댓글·Slack 메시지를 발행하지 않고 기존 원장도 바꾸지 않는다. 운영 모델은 그대로 유지된다.

## 먼저 결과 화면만 확인하기

1. [DIEM Economy Actions](https://github.com/betterbit-ai/today_econ/actions/workflows/diem_economy.yml)를 연다.
2. `Run workflow` → Branch `main` → operation `compare_editorial`을 선택한다.
3. `comparison_mode`는 **preview**, `comparison_batch`는 **first**로 두고 실행한다.
4. 완료된 실행 화면 아래 **Artifacts**에서 `diem-editorial-comparison-실행번호-first`를 다운로드한다.
5. ZIP을 풀고 **report.html**을 브라우저로 연다. 원문과 두 모델의 결과를 나란히 보는 화면이다. 이 모드의 `미실행`은 정상이며 모델 사용량을 소비하지 않는다.

`report.json`은 전체 결과·원문 입력 해시·실패 원인·시도별 초안을 보존하고, `report.md`는 간단한 텍스트 요약이다. artifact 보존 기간은14일이므로 필요한 결과는 다운로드해 보관한다.

## Claude Pro 연결: 처음 한 번만

토큰은 채팅이나 저장소 파일에 보내지 않는다. 본인의 터미널과 GitHub Secret 화면에서만 다룬다.

1. 터미널에서 공식 Claude Code가 없다면 설치한다. 이 비교 런타임은 버전2.1.302로 고정했다.

   ```sh
   npm install --global @anthropic-ai/claude-code@2.1.302
   ```

2. 다음 명령을 실행한다. 열린 공식 브라우저에서 **본인의 Claude Pro 계정**으로 인증한다. API Console 결제 계정을 선택하지 않는다.

   ```sh
   claude setup-token
   ```

3. 터미널에 나온 토큰을 본인이 복사한다. [저장소 Actions Secrets](https://github.com/betterbit-ai/today_econ/settings/secrets/actions) → `New repository secret`을 연다.
4. Name을 **CLAUDE_CODE_OAUTH_TOKEN**, Secret을 방금 발급한 값으로 저장한다. 같은 이름이 있으면 수정한다. `Variables` 탭에 넣지 않는다. 값은 채팅·스크린샷·커밋에 남기지 않는다.

이후 매일 승인하거나 Mac을 켜둘 필요는 없다. GitHub 실행에서는 공식 CLI를 임시 환경에 설치하고 이 Secret으로 인증한다. Groq는 기존 `GROQ_API_KEY`를 사용한다. 별도 Anthropic API 키로 전환하거나 추가 결제 설정을 켜지 않는다. Pro 포함 한도 안에서만 검증하려면 본인의 Claude 사용량 설정에서 **Usage credits / 추가 사용량 결제를 꺼 둔다**. 이미 켜진 계정 설정은 이 도구가 변경하거나 차단하지 못한다.

공식 근거: [구독 CI 토큰](https://code.claude.com/docs/en/authentication#generate-a-long-lived-token), [프로그래밍 실행](https://code.claude.com/docs/en/headless), [CLI 제한 옵션](https://code.claude.com/docs/en/cli-reference), [계정의 추가 사용량 설정](https://code.claude.com/docs/en/costs#add-usage-credits-to-your-subscription).

## 실제 비교 실행하기

1. 위 Actions에서 operation `compare_editorial`, mode **live**, batch **first**로 실행한다. 첫 기사5개를 순차 비교한다.
2. 보고서의 상태와 원고를 확인한다. Pro 제한이나 인증 오류가 나면 중단 사유를 확인하고 같은 실행을 반복 누르지 않는다.
3. 정상 완료 후 batch **second**로 한 번 더 실행한다. 나머지5개다. 전체는 경제5·시사5로 고정했다. 두 보고서를 함께 보관한다.
4. 모델마다 초기 생성·본문 복구1회·제목 복구1회로 제한한다. fallback 모델은 없고 한 기사·한 모델당 최대3회, 한 묶음당 최대30회 요청이다. 실제 요청 수는 보고서에 남는다. 묶음 전체는20분 예산이며 다음 호출이 그 안에 끝날 여유가 없으면 중단하고 미완료로 표시한다. Pro의 평소 사용과 한도를 공유하므로 전체 처리량을 보장하지 않는다.

원문은 최신 뉴스를 다시 수집하지 않고 고정된 과거 원장을 참조한다. 입력 내용이 달라지면 해시 검사로 멈춘다. 결과가 좋은 기사만 골라 비교하거나 과거 성공 원고를 새 모델 출력으로 채우지 않는다.

## 무엇을 보고 판단할지

- **양쪽 검사 완료:** 두 모델 모두 실제 원고 검사까지 도달한 공통 표본 수다. 인증·한도 오류로 빠진 사례를 우열 비교에 포함하지 않는다.
- **자동 검사 통과 / 첫 응답 통과:** 같은 기존 검사기를 통과했는지, 교정 없이 통과했는지다. 사실 정확성·한국어 품질·독자 관심을 보증하지 않는다.
- **시도별 기록:** 통과한 최종 원고뿐 아니라 실패한 초안과 재교정 기록도 확인한다.
- **숫자 생략:** 오류를 피하려고 수치를 빼면서 중요한 정보를 잃었는지 본다.
- **사람 검토:** 원문과 비교해 사실·확정 상태·자연스러운 한국어·제목의 정보 가치·홍보성 서술을 확인한다. 이 제한된 도입 평가를 위한 검토이며 매일 발행 승인으로 전환하는 것이 아니다.
- **검증기 보호 사례10개:** 기간·분모·비교 기준·지원/납부·확정 상태의 정상 표현과 오류 표현을 각각 검사한다. 이 점수는 모델 성능 점수와 별도다. 하나라도 실패하면 모델 호출을 막는다.

제안한 전환 기준은10건 중8건 이상 통과·수동 사실/상태 사고0건이며, baseline보다 승인 가능한 원고가2건 이상 늘거나 교정 부담이 명확히 줄어드는 것이다. 표본10개는 초기 도입 판단용이다. 결과만으로 도달 성과 우위나 장기 안정성을 확정하지 않는다. 기준을 만족해도 운영 provider는 자동 전환되지 않는다.

## 오류가 나면

| 표시 | 의미와 조치 |
|---|---|
| 인증 연결 필요 / setup_required | Secret 또는 고정 CLI가 없음. 표시된 이름을 확인한다. 양 모델 모두 호출하지 않았으므로 성능 결과가 아니다. |
| claude_auth_required | 공식 setup-token으로 재인증하고 같은 Secret을 수정한다. 토큰 값을 전달하지 않는다. |
| claude_usage_limited | Pro 사용량 제한. 초기화 후 나머지를 다시 검증한다. 유료 API나 추가 결제로 자동 전환하지 않는다. |
| incomplete / 사용 불가 | 인증·한도·통신 등으로 공정한 비교가 끝나지 않음. 그 모델은 묶음의 다음 기사 호출도 멈춘다. |
| 검사 실패 | 모델 출력이 원문 의미·숫자·제목·문장 등 기존 gate를 통과하지 못함. 원문과 시도별 출력으로 검사기의 과잉 차단인지도 확인한다. |
| 입력 해시 불일치 | 고정 원문이 변했음. 데이터를 조용히 바꾸지 말고 데이터셋 버전을 새로 만들어야 한다. |

실행 링크와 오류 문구만 공유하면 된다. 토큰을 다시 보내지 않는다.

## 로컬 미리보기

```sh
node scripts/compare-diem-editorial.js --mode preview --batch first
```

출력에 표시된 디렉터리의 `report.html`을 연다. 로컬 live는 Claude OAuth와 Groq 키를 환경에 설정한 경우에만 동작한다. 코드에 키를 적지 않는다. 비교 런타임은 Claude에 빈 디렉터리·최소 환경만 제공하고 파일 도구·명령 실행·MCP·개인 설정·세션 저장을 끈다.
