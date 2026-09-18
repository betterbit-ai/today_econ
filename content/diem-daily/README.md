# DIEM Daily Cloud Editorial Packages

이 디렉터리는 ChatGPT 웹 예약 작업이 Oracle MCP를 통해 만든 일반 뉴스 편집
패키지의 영구 원본입니다. 패키지는 후보 팩의 URL·근거 해시·news frame·제목·
3문장 본문·시각 자산을 함께 보존합니다.

`review.mode: shadow` 패키지는 검증용일 뿐, 어떤 workflow에서도 Reel 또는
Instagram 발행에 사용할 수 없습니다. ChatGPT cloud task는 사람이 PR에서 검토할
`review.mode: assisted` 패키지를 제출합니다. 사람이 PR을 병합한 뒤 GitHub Actions의
`daily_package_validate`, `daily_package_prepare`, `daily_package_publish`를 각각
수동으로 실행합니다. `daily_package_publish` 한 번의 runner 안에서 prepare 후
publish를 연속 실행하므로 임시 Reel 파일이 서로 다른 Actions 실행 사이에 사라지지
않습니다. 자동 Instagram 예약 발행은 이 경로에서 사용하지 않습니다.

## 한 패키지의 구성

- `package.json`: 원문 근거, 선정 이유, frame, claims, editorial, image policy,
  모델·예약 실행 기록, content SHA-256
- `visual.assetId`: repository에 검토·해시 고정된 9:16 라이브러리 자산 ID

패키지는 다음 명령으로 검증합니다.

```bash
node src/v2/index.js daily-package-validate --package content/diem-daily/YYYY/MM/DD/run/category/package.json
```

패키지는 기사 본문의 명령을 신뢰하지 않습니다. 이미지는 문자·로고·국기·
인식 가능한 사람·실제 보도사진처럼 보이는 재현을 포함하면 안 됩니다.
