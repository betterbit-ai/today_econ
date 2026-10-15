---
date: 2026-10-15
scope: tech
status: active
source: user-request-to-publish
---

# 검증된 GitHub Secret으로 발행하고 공개 토큰 파일 갱신을 분리한다

## Decision

GitHub 운영은 repository_secret을 기본 credential source로 사용한다. 기존 공개 암호화 파일을 갱신하는 승인 여부가 현재 유효한 Secret을 사용하는 정상 발행을 막지 않게 한다.

## Context and constraints

새 Secret은 실제 계정 ID·사용자명·Vision 검증을 통과했다. 기존 daily-package 발행도 이미 Secret을 직접 사용한다. 사용자는 발행 진행을 명확히 요청했다. 반면 공개 저장소의 암호화 credential 파일 교체는 자동 승인 검토가 별도 동의를 요구했다.

Secret 모드는 기존 vault를 읽거나 쓰지 않는다. Secret 누락·잘못된 모드는 fail closed한다. 로컬 기본값은 encrypted_vault로 유지해 기존 사용자의 동작을 보존한다. 양 workflow의 기본값은 repository_secret이며 명시적 repository variable로만 encrypted_vault에 돌아간다. 공개 파일은 삭제·변환·갱신하지 않는다.

Secret 모드의 refresh 명령은 API·파일 작업 전 skipped를 반환하고, 주간 암호화 회전 job은 encrypted_vault opt-in에서만 실행한다. 장기 credential 자동 회전은 별도 미완료 항목이다. 현재 유효 토큰을 사용하는 자동 뉴스 발행·예약 시각·하루 상한·품질 검사는 유지한다.

## Alternatives considered

- 공개 암호화 파일 갱신만 기다리기: 기존 Secret 직접 발행 경로가 있는데도 현재 발행을 불필요하게 막는다.
- 예전 vault를 계속 우선하기: 새 Secret을 저장해도 무효화된 토큰으로 요청한다.
- Secret 모드에서 회전된 토큰을 공개 파일로 저장하기: 차단된 credential 저장 작업을 간접 실행하게 된다.

## Revisit when

장기 토큰 자동 회전을 위한 저장 경로가 명시적으로 승인·검증됐을 때 재검토한다. Secret 유효기간은 발급 정보로 관리하며 자동 회전 완료로 표시하지 않는다. 실제 정상 콘텐츠의 media ID·permalink·실행 SHA 확인 전에는 발행 성공으로 표시하지 않는다.
