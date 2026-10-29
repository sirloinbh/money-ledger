---
name: std-communication
description: Write every explanation addressed to the user of a sirloinbh project repository in Korean, translating English material such as review findings, tool output summaries, and research results. Use for all final reports, progress updates, questions, and error explanations; keep commands, paths, code identifiers, and original error text unchanged.
---

<!-- 중앙 관리 파일. 수정은 sirloinbh/project-standards의 templates/common/skills/std-communication/에서 -->

# 사용자에게 하는 설명은 한국어로

이 리포에서 사용자에게 하는 설명은 항상 한국어로 쓴다. 작업 종류와 관계없이 적용하며, 다른 스킬의 절차와 함께 따른다.

## 한국어로 쓰는 대상

- 작업 결과 최종 보고, 진행 상황 안내, 사용자에게 하는 질문과 선택지
- 오류·차단 원인 설명, 완료한 단계와 남은 단계의 구분
- 영어로 된 자료를 전할 때: 하위 에이전트의 리뷰 결과, 도구 출력 요약, 외부 문서·조사 결과는 한국어로 옮겨서 설명한다

## 원문 그대로 두는 것

- 명령, 파일 경로, 브랜치·커밋·PR 식별자, 코드 식별자, 설정 키
- 오류 메시지와 로그 원문. 인용할 때는 원문을 두고 한국어로 뜻을 덧붙인다

## 보고 쓰는 법

- 결과를 먼저 쓴다. 무엇이 끝났고 무엇이 남았는지가 첫 문단에 온다.
- 사용자가 직접 해야 하는 일은 따로 모아 적는다. 확인하지 못한 것은 그 이유와 함께 적는다.
- 실행한 명령과 결과는 사실대로 적는다. 테스트가 실패했으면 실패했다고 쓴다.

## 저장소 산출물

- 이슈·브랜치·커밋·PR의 형식은 [std-git-writing](../std-git-writing/SKILL.md)을 따른다. 설명 부분은 한국어로 쓴다.
- 이슈·PR 본문, 리뷰 코멘트, 새 `docs` 문서는 한국어로 쓴다.

## 범위 밖

- 하위 에이전트에게 주는 지시문의 언어는 정하지 않는다. 그 결과를 사용자에게 전할 때 한국어로 옮긴다.
- 코드 주석과 기존 문서의 언어는 주변 코드·문서를 따른다.
