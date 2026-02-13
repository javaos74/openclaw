# 구현 계획: KakaoTalk Extension

## 개요

Swift CLI 브릿지(`kakaotalk-bridge`)와 TypeScript OpenClaw 확장(`extensions/kakaotalk/`)을 구현한다. 브릿지는 macOS AX API로 KakaoTalk UI를 제어하고, 확장은 브릿지를 자식 프로세스로 관리하며 OpenClaw 채널 플러그인 계약을 구현한다.

## Tasks

- [x] 1. 확장 프로젝트 구조 및 설정 파일 생성
  - [x] 1.1 `extensions/kakaotalk/` 디렉토리에 `package.json`, `openclaw.plugin.json`, `tsconfig.json` 생성
    - BlueBubbles 확장의 패턴을 따름
    - `package.json`에 `@openclaw/kakaotalk` 이름, `"type": "module"`, `devDependencies: { "openclaw": "workspace:*" }`, `openclaw.channel` 메타데이터 포함
    - _Requirements: 9.1_
  - [x] 1.2 `extensions/kakaotalk/src/types.ts` 생성 — 타입 정의 및 타겟 정규화 함수
    - `KakaoTalkChat`, `KakaoTalkMessage`, `KakaoTalkAccountConfig`, `DmPolicy` 타입 정의
    - `normalizeKakaoTalkTarget(raw: string): string` 함수 구현 (트리밍, 빈 문자열 에러)
    - _Requirements: 11.2_
  - [ ]\* 1.3 `extensions/kakaotalk/src/types.test.ts` 생성 — 타겟 정규화 속성 테스트
    - **Property 7: 타겟 정규화**
    - **Validates: Requirements 11.2**
  - [x] 1.4 `extensions/kakaotalk/src/config-schema.ts` 생성 — Zod 설정 스키마
    - `kakaotalkAccountSchema` 및 `KakaoTalkConfigSchema` 정의
    - `dmPolicy`, `allowFrom`, `pollIntervalMs` (min 500, max 60000), `bridgePath`, `enabled`, `textChunkLimit` 필드
    - _Requirements: 9.2_
  - [ ]\* 1.5 `extensions/kakaotalk/src/config-schema.test.ts` 생성 — 설정 스키마 속성 테스트
    - **Property 5: 설정 스키마 검증**
    - **Validates: Requirements 9.2**

- [x] 2. Checkpoint — 기본 타입 및 설정 검증
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. RPC 클라이언트 구현
  - [x] 3.1 `extensions/kakaotalk/src/client.ts` 생성 — `KakaoTalkRpcClient` 클래스
    - `IMessageRpcClient` 패턴을 따름: `spawn`, stdin/stdout JSON-RPC, pending map, 알림 콜백
    - `start()`, `stop()`, `waitForClose()`, `request<T>(method, params, opts)` 메서드
    - Bridge 시작 인자: `["rpc", "--poll-interval", String(pollIntervalMs)]`
    - 응답 `id` 매칭, 타임아웃 처리, 프로세스 종료 시 pending 일괄 reject
    - `id` 없는 메시지는 `onNotification` 콜백으로 전달
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 1.5_
  - [ ]\* 3.2 `extensions/kakaotalk/src/client.test.ts` 생성 — RPC 클라이언트 속성 테스트
    - **Property 1: 알림 라우팅**
    - **Validates: Requirements 1.5, 8.3**
  - [ ]\* 3.3 `extensions/kakaotalk/src/client.test.ts`에 추가 — 요청-응답 매칭 속성 테스트
    - **Property 3: 요청-응답 ID 매칭**
    - **Validates: Requirements 8.2**
  - [ ]\* 3.4 `extensions/kakaotalk/src/client.test.ts`에 추가 — 프로세스 종료 속성 테스트
    - **Property 4: 프로세스 종료 시 pending 거부**
    - **Validates: Requirements 8.5**

- [x] 4. 계정 해석 및 보안 구현
  - [x] 4.1 `extensions/kakaotalk/src/accounts.ts` 생성 — 계정 해석 로직
    - `ResolvedKakaoTalkAccount` 타입, `resolveKakaoTalkAccount`, `listKakaoTalkAccountIds` 함수
    - 기본 설정과 계정별 설정 병합, 기본 bridgePath `"kakaotalk-bridge"`, 기본 pollIntervalMs `3000`
    - _Requirements: 9.2, 9.5_
  - [x] 4.2 `extensions/kakaotalk/src/runtime.ts` 생성 — PluginRuntime 싱글턴
    - `setKakaoTalkRuntime`, `getKakaoTalkRuntime` 함수 (iMessage 패턴)
    - _Requirements: 9.1_

- [x] 5. 아웃바운드 전송 및 상태 프로브 구현
  - [x] 5.1 `extensions/kakaotalk/src/send.ts` 생성 — 메시지 전송 함수
    - `sendMessageKakaoTalk(to, text, opts)` 함수
    - 빈 텍스트/공백 문자열 사전 검증 (RPC 호출 전 에러)
    - RPC_Client를 통해 `send_message` 호출
    - _Requirements: 6.4, 11.1, 11.2, 11.3_
  - [ ]\* 5.2 `extensions/kakaotalk/src/send.test.ts` 생성 — 빈 텍스트 거부 속성 테스트
    - **Property 2: 빈 텍스트 거부**
    - **Validates: Requirements 6.4**
  - [x] 5.3 `extensions/kakaotalk/src/probe.ts` 생성 — 상태 프로브 함수
    - `probeKakaoTalk(params)` 함수: 임시 RPC_Client로 `check_status` 호출
    - `KakaoTalkProbe` 타입: `{ ok, running?, accessible?, error? }`
    - _Requirements: 12.1, 12.2, 12.3_

- [x] 6. 인바운드 모니터링 구현
  - [x] 6.1 `extensions/kakaotalk/src/monitor.ts` 생성 — 메시지 모니터링
    - `monitorKakaoTalkProvider(opts)` 함수
    - RPC_Client 생성, Bridge 시작, `new_message` 알림 수신 시 런타임 라우팅
    - `abortSignal`로 정상 종료, Bridge 비정상 종료 시 에러 로깅
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

- [x] 7. 채널 플러그인 조립
  - [x] 7.1 `extensions/kakaotalk/src/channel.ts` 생성 — `ChannelPlugin` 구현
    - `kakaotalkPlugin` 객체: id, meta, capabilities, config, security, pairing, outbound, status, gateway, messaging 어댑터
    - dmPolicy 기반 보안 (pairing/allowlist/open/disabled)
    - macOS 플랫폼 체크 (gateway.startAccount에서)
    - _Requirements: 9.1, 9.3, 9.4, 13.1, 13.2_
  - [ ]\* 7.2 `extensions/kakaotalk/src/channel.test.ts` 생성 — DM 정책 속성 테스트
    - **Property 6: DM 정책 적용**
    - **Validates: Requirements 9.3, 9.4**
  - [x] 7.3 `extensions/kakaotalk/index.ts` 생성 — 플러그인 진입점
    - `register(api)` 에서 `api.registerChannel({ plugin: kakaotalkPlugin })` 호출
    - _Requirements: 9.1_
  - [x] 7.4 `extensions/kakaotalk/src/onboarding.ts` 생성 — CLI 온보딩 위저드
    - bridgePath 설정, 상태 확인, AX 권한 안내
    - _Requirements: 2.5, 9.5_

- [x] 8. Checkpoint — TypeScript 확장 완성 검증
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Swift CLI 브릿지 프로젝트 구조 생성
  - [x] 9.1 `kakaotalk-bridge/Package.swift` 생성 — Swift 패키지 정의
    - macOS 14+ 타겟, ApplicationServices 프레임워크 링크
    - _Requirements: 1.1_
  - [x] 9.2 `kakaotalk-bridge/Sources/JsonRpc.swift` 생성 — JSON-RPC 프로토콜 처리
    - stdin 줄 읽기, JSON 파싱, 요청/응답/알림 구조체
    - 에러 코드: -32700 (파싱), -32601 (메서드 미발견), -32000~-32005 (커스텀)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [x] 9.3 `kakaotalk-bridge/Sources/Accessibility.swift` 생성 — AX API 래퍼
    - KakaoTalk 프로세스 찾기, AX 권한 확인, 메인 윈도우 참조 획득
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 10. 브릿지 핵심 기능 구현
  - [x] 10.1 `kakaotalk-bridge/Sources/ChatList.swift` 생성 — 채팅 목록 읽기
    - `list_chats` 메서드 구현: scroll area > table > row 탐색, limit 적용
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [x] 10.2 `kakaotalk-bridge/Sources/ChatRoom.swift` 생성 — 채팅방 조작
    - `open_chat`: CGEvent 더블클릭으로 채팅방 열기, 윈도우 대기
    - `read_messages`: 채팅방 윈도우에서 메시지 읽기, since 필터링
    - `send_message`: 텍스트 입력 필드에 입력 + Enter 시뮬레이션, 자동 채팅방 열기
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4_
  - [x] 10.3 `kakaotalk-bridge/Sources/Polling.swift` 생성 — 폴링 루프
    - 설정 간격으로 Chat_List 읽지 않은 메시지 수 변화 감지
    - 변화 감지 시 채팅방 열기 → 메시지 읽기 → `new_message` 알림 전송
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [x] 10.4 `kakaotalk-bridge/Sources/main.swift` 생성 — 진입점
    - CLI 인자 파싱 (`rpc`, `--poll-interval`)
    - JSON-RPC 서버 루프 시작, 폴링 루프 시작
    - 메서드 디스패치: check_status, list_chats, open_chat, read_messages, send_message
    - _Requirements: 1.1, 7.4_

- [x] 11. Final checkpoint — 전체 통합 검증
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- `*` 표시된 태스크는 선택적이며 빠른 MVP를 위해 건너뛸 수 있다
- Bridge(Swift) 태스크(9, 10)는 macOS에서만 빌드/테스트 가능
- 속성 기반 테스트는 fast-check 라이브러리를 사용하며 각 테스트는 최소 100회 반복
- 플러그인 의존성은 `extensions/kakaotalk/package.json`에만 추가 (루트 package.json 수정 금지)
