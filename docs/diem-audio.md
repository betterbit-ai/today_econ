# DIEM 사용자 제공 음원 추가 가이드

DIEM V2 자동 발행은 Instagram 앱에서 고르는 유행 음원을 자동으로 붙이지
않고, MP4 파일 안에 오디오를 먼저 합성한 뒤 Reels API로 업로드한다.
따라서 더 다양한 음악을 쓰려면 운영자가 사용 권리가 확인된 음원 파일을
프로젝트에 등록해야 한다.

## 권장 원칙

1. 직접 만든 음원 또는 상업적 SNS 사용이 허용된 음원만 사용한다.
2. 다운로드 페이지 URL, 라이선스 이름, 저작자/출처를 함께 기록한다.
3. 권리가 애매하거나 Instagram에서 음소거될 가능성이 큰 음원은 쓰지
   않는다.
4. 보컬이 강한 곡보다 8~20초 구간을 잘라 써도 어색하지 않은 무보컬
   배경음악을 우선한다.
5. DIEM 자동 파이프라인에서는 `bright`와 `serious` 두 mood로 순환한다.
   경제·호재·시장 회복 톤은 `bright`, 정책·위험·중립 뉴스 톤은
   `serious`로 등록한다.
6. 원본 파일은 출처별 폴더(`assets/mixkit`, `assets/pixabay` 등)에
   보존하고, 실제 릴스 합성에는 `assets/audio/diem`에 있는 가공본을
   사용한다.

## 어디서 받으면 좋은가

- YouTube Audio Library: YouTube Studio의 Audio Library에서 다운로드한다.
  가능하면 `Attribution not required` 필터를 사용한다.
- Pixabay Music: 음원 상세 페이지에서 다운로드하고, 페이지 URL과
  `Pixabay Content License`를 기록한다.
- Mixkit Stock Music: 각 트랙이 Stock Music Free License 대상인지
  확인하고 다운로드한다.
- 유료 라이브러리: Uppbeat, Artlist, Epidemic Sound 등은 계정/플랜별
  SNS·상업 이용 범위를 확인한 뒤 사용한다. 무료 티어는 워터마크,
  attribution, 채널 제한이 있을 수 있으니 DIEM 계정 사용이 허용되는지
  따로 확인한다.

## 등록 방법

1. 음원을 다운로드한다. 권장 포맷은 `.mp3` 또는 `.m4a`다.
2. 원본 다운로드 페이지 URL과 라이선스 이름을 메모한다.
3. 프로젝트 루트에서 다음 명령을 실행한다.

   ```bash
   npm run diem:audio:import -- ~/Downloads/my-track.mp3 \
     --id diem-market-pulse-01 \
     --mood bright \
     --title "Market Pulse 01" \
     --license "Pixabay Content License" \
     --source "https://pixabay.com/music/..."
   ```

4. 시사·정책 톤의 차분한 음악은 `--mood serious`로 등록한다.

   ```bash
   npm run diem:audio:import -- ~/Downloads/calm-newsroom.mp3 \
     --id diem-newsroom-01 \
     --mood serious \
     --title "Calm Newsroom 01" \
     --license "Mixkit Stock Music Free License" \
     --source "https://mixkit.co/free-stock-music/..."
   ```

5. 등록 후 `assets/audio/diem/manifest.json`에 새 트랙과 SHA-256이
   자동으로 추가된다. 다음 발행부터 최근 사용 이력 기준으로 자동 순환한다.

## 현재 등록된 외부 음원 처리 방식

- Mixkit 5곡과 Pixabay 5곡은 원본을 보존한 뒤 DIEM용 MP3로 별도
  가공했다.
- 가공본은 8초 지점부터 14초를 잘라 시작·종료 페이드, 48kHz 스테레오,
  낮은 배경음량에 맞춘 정규화를 적용했다.
- `assets/audio/diem/manifest.json`의 `processed: true`,
  `startOffsetSeconds`, `durationSeconds`, `originalPath`, `provider` 값으로
  출처와 가공 상태를 추적한다.
- 현재 릴스 영상 길이는 7초이므로 합성 단계에서는 영상 길이에 맞춰
  앞부분이 사용된다. 나중에 릴스를 10~14초로 늘려도 같은 가공본을
  재사용할 수 있다.

## 좋은 선곡 기준

- 길이: 원본은 30초 이상이어도 괜찮다. 릴스 생성 시 영상 길이에 맞춰
  필요한 구간만 사용한다.
- 분위기: 뉴스 읽는 데 방해되지 않는 낮은 밀도의 비트/앰비언트가 좋다.
- 피해야 할 것: 유명 가요 리믹스, 틱톡/릴스에서 추출한 음원, 출처를
  알 수 없는 “no copyright” 유튜브 업로드, 보컬 훅이 강한 곡.

## 다음 개선 후보

현재는 가공본의 첫 구간을 영상 길이에 맞춰 사용한다. 더 자연스럽게
만들려면 트랙별로 실제로 가장 좋은 7~14초 구간을 직접 청취해
`startOffsetSeconds`를 조정하는 품질 검수 단계를 추가할 수 있다.
