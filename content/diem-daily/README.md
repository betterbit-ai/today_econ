# DIEM Daily Cloud Editorial Packages

이 디렉터리는 ChatGPT 웹 예약 작업이 Oracle MCP를 통해 만든 일반 뉴스 편집
패키지의 영구 원본입니다. 패키지는 후보 팩의 URL·근거 해시·news frame·제목·
3문장 본문·시각 자산을 함께 보존합니다.

`review.mode: shadow` 패키지는 검증용일 뿐, 어떤 workflow에서도 Reel 또는
Instagram 발행에 사용할 수 없습니다. Assisted와 Auto 전환은
`docs/implementation/chatgpt-oracle-cloud-editorial-plan.md`의 capability gate와
rollout 기준을 통과한 뒤에만 허용됩니다.

## 한 패키지의 구성

- `package.json`: 원문 근거, 선정 이유, frame, claims, editorial, image policy,
  모델·예약 실행 기록, content SHA-256
- `background.png`: ImageGen handoff PoC가 통과한 뒤에만 포함하는 세로형
  editorial illustration

패키지는 다음 명령으로 검증합니다.

```bash
node src/v2/index.js daily-package-validate --package content/diem-daily/YYYY/MM/DD/run/category/package.json
```

패키지는 기사 본문의 명령을 신뢰하지 않습니다. 이미지는 문자·로고·국기·
인식 가능한 사람·실제 보도사진처럼 보이는 재현을 포함하면 안 됩니다.
