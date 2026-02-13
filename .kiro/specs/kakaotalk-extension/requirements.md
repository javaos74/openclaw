# 요구사항 문서

## 소개

KakaoTalk 데스크톱 앱(macOS)과 OpenClaw 메시징 플랫폼을 연동하는 확장 플러그인이다. KakaoTalk은 CLI, API, 또는 접근 가능한 로컬 데이터를 제공하지 않으므로, macOS Accessibility API를 통해 UI를 자동화하는 Swift CLI 브릿지(`kakaotalk-bridge`)를 사용한다. 브릿지는 JSON-RPC 2.0 over stdio로 OpenClaw 확장과 통신하며, 기존 `imsg rpc` 패턴을 따른다.

## 용어집

- **Bridge**: KakaoTalk 데스크톱 앱의 UI를 macOS Accessibility API로 제어하는 Swift CLI 실행 파일 (`kakaotalk-bridge`)
- **RPC_Client**: Bridge 프로세스를 자식 프로세스로 생성하고 JSON-RPC 2.0 over stdio로 통신하는 TypeScript 클래스
- **Extension**: OpenClaw 플러그인 시스템에 등록되는 KakaoTalk 채널 플러그인 (`extensions/kakaotalk/`)
- **Chat_Room**: KakaoTalk에서 별도 윈도우로 열리는 개별 대화방
- **Chat_List**: KakaoTalk 메인 윈도우(`"카카오톡"`)의 대화 목록
- **AX_API**: macOS Accessibility API (ApplicationServices 프레임워크)
- **Polling**: 새 메시지를 감지하기 위해 주기적으로 채팅방을 확인하는 방식
- **Gateway**: OpenClaw의 메시지 라우팅 및 채널 관리 시스템

## 요구사항

### 요구사항 1: Swift CLI 브릿지 — JSON-RPC 서버

**사용자 스토리:** 개발자로서, Bridge가 JSON-RPC 2.0 프로토콜로 통신하길 원한다. 이를 통해 TypeScript 확장이 표준화된 방식으로 KakaoTalk을 제어할 수 있다.

#### 인수 조건

1. WHEN Bridge가 시작되면, THE Bridge SHALL stdin에서 줄바꿈으로 구분된 JSON-RPC 2.0 요청을 읽고 stdout으로 응답을 출력한다
2. WHEN 유효한 JSON-RPC 요청을 수신하면, THE Bridge SHALL `jsonrpc`, `id`, `result` 또는 `error` 필드를 포함하는 JSON-RPC 2.0 응답을 반환한다
3. IF 잘못된 형식의 JSON을 수신하면, THEN THE Bridge SHALL JSON-RPC 파싱 에러 응답(코드 -32700)을 반환한다
4. IF 존재하지 않는 메서드를 호출하면, THEN THE Bridge SHALL JSON-RPC 메서드 미발견 에러 응답(코드 -32601)을 반환한다
5. WHEN 서버 푸시 알림을 전송할 때, THE Bridge SHALL `id` 필드 없이 `method`와 `params` 필드만 포함하는 JSON-RPC 알림 형식을 사용한다

### 요구사항 2: Swift CLI 브릿지 — KakaoTalk 상태 확인

**사용자 스토리:** 사용자로서, KakaoTalk 데스크톱 앱이 실행 중이고 접근 가능한 상태인지 확인하길 원한다. 이를 통해 연결 문제를 빠르게 진단할 수 있다.

#### 인수 조건

1. WHEN `check_status` 메서드가 호출되면, THE Bridge SHALL KakaoTalk 프로세스 실행 여부를 확인한다
2. WHEN `check_status` 메서드가 호출되면, THE Bridge SHALL macOS Accessibility 권한 부여 여부를 확인한다
3. WHEN `check_status` 메서드가 호출되면, THE Bridge SHALL 메인 윈도우(`"카카오톡"`) 접근 가능 여부를 확인한다
4. IF KakaoTalk이 실행 중이지 않으면, THEN THE Bridge SHALL `running: false`를 포함하는 상태 응답을 반환한다
5. IF Accessibility 권한이 없으면, THEN THE Bridge SHALL `accessible: false`와 권한 요청 안내 메시지를 포함하는 상태 응답을 반환한다

### 요구사항 3: Swift CLI 브릿지 — 채팅 목록 읽기

**사용자 스토리:** 사용자로서, 현재 KakaoTalk의 대화 목록을 조회하길 원한다. 이를 통해 어떤 대화방이 있는지 확인하고 관리할 수 있다.

#### 인수 조건

1. WHEN `list_chats` 메서드가 호출되면, THE Bridge SHALL 메인 윈도우의 scroll area > table > row 구조에서 대화 목록을 최신순으로 읽는다
2. WHEN 대화 목록을 반환할 때, THE Bridge SHALL 각 항목에 대화방 이름, 마지막 메시지 시간, 읽지 않은 메시지 수를 포함한다
3. WHEN `limit` 파라미터가 제공되면, THE Bridge SHALL 최대 해당 개수만큼의 대화방을 반환한다. 기본값은 50이다
4. IF 메인 윈도우에 접근할 수 없으면, THEN THE Bridge SHALL 윈도우 접근 불가 에러를 반환한다

### 요구사항 4: Swift CLI 브릿지 — 채팅방 열기

**사용자 스토리:** 사용자로서, 특정 대화방을 열어 메시지를 읽고 보내길 원한다. 이를 통해 원하는 상대와 대화할 수 있다.

#### 인수 조건

1. WHEN `open_chat` 메서드가 `name` 파라미터와 함께 호출되면, THE Bridge SHALL Chat_List에서 해당 이름의 행을 찾아 CGEvent 더블클릭으로 대화방을 연다
2. WHEN 대화방이 성공적으로 열리면, THE Bridge SHALL 해당 이름의 윈도우가 나타날 때까지 대기한 후 성공 응답을 반환한다
3. IF 해당 이름의 대화방을 Chat_List에서 찾을 수 없으면, THEN THE Bridge SHALL 대화방 미발견 에러를 반환한다
4. IF 대화방 윈도우가 타임아웃 내에 나타나지 않으면, THEN THE Bridge SHALL 타임아웃 에러를 반환한다

### 요구사항 5: Swift CLI 브릿지 — 메시지 읽기

**사용자 스토리:** 사용자로서, 열린 대화방의 메시지를 읽길 원한다. 이를 통해 수신된 메시지를 확인하고 처리할 수 있다.

#### 인수 조건

1. WHEN `read_messages` 메서드가 `name` 파라미터와 함께 호출되면, THE Bridge SHALL 해당 이름의 윈도우에서 scroll area > table > row 구조를 통해 메시지를 읽는다
2. WHEN 메시지를 반환할 때, THE Bridge SHALL 각 메시지에 발신자 이름, 메시지 내용, 시간 정보를 포함한다
3. WHEN `since` 파라미터가 제공되면, THE Bridge SHALL 해당 시점 이후의 메시지만 반환한다
4. IF 해당 이름의 윈도우가 열려 있지 않으면, THEN THE Bridge SHALL 윈도우 미발견 에러를 반환한다

### 요구사항 6: Swift CLI 브릿지 — 메시지 전송

**사용자 스토리:** 사용자로서, 대화방에 메시지를 보내길 원한다. 이를 통해 AI 응답을 KakaoTalk으로 전달할 수 있다.

#### 인수 조건

1. WHEN `send_message` 메서드가 `name`과 `text` 파라미터와 함께 호출되면, THE Bridge SHALL 해당 대화방 윈도우의 텍스트 입력 필드에 텍스트를 입력하고 Enter 키를 시뮬레이션한다
2. WHEN 대화방 윈도우가 열려 있지 않으면, THE Bridge SHALL 자동으로 대화방을 열고 메시지를 전송한다
3. IF 텍스트 입력 필드를 찾을 수 없으면, THEN THE Bridge SHALL 입력 필드 미발견 에러를 반환한다
4. IF 빈 텍스트가 전달되면, THEN THE Bridge SHALL 빈 메시지 에러를 반환한다

### 요구사항 7: Swift CLI 브릿지 — 폴링 기반 새 메시지 감지

**사용자 스토리:** 사용자로서, 새 메시지가 도착하면 자동으로 알림을 받길 원한다. 이를 통해 실시간에 가까운 대화가 가능하다.

#### 인수 조건

1. WHILE Bridge가 실행 중일 때, THE Bridge SHALL 설정된 간격으로 Chat_List의 읽지 않은 메시지 수 변화를 감지한다
2. WHEN 새 메시지가 감지되면, THE Bridge SHALL `new_message` 알림을 JSON-RPC 알림 형식으로 전송한다
3. WHEN `new_message` 알림을 전송할 때, THE Bridge SHALL 대화방 이름, 발신자, 메시지 내용, 시간 정보를 포함한다
4. THE Bridge SHALL 폴링 간격을 밀리초 단위의 설정 파라미터로 받는다

### 요구사항 8: RPC 클라이언트

**사용자 스토리:** 개발자로서, TypeScript에서 Bridge와 통신하는 클라이언트를 사용하길 원한다. 이를 통해 확장 플러그인이 Bridge를 쉽게 제어할 수 있다.

#### 인수 조건

1. WHEN RPC_Client가 시작되면, THE RPC_Client SHALL Bridge 실행 파일을 자식 프로세스로 생성하고 stdio 파이프를 연결한다
2. WHEN `request` 메서드가 호출되면, THE RPC_Client SHALL JSON-RPC 요청을 stdin으로 전송하고 대응하는 응답을 반환한다
3. WHEN Bridge로부터 `id` 없는 JSON-RPC 메시지를 수신하면, THE RPC_Client SHALL 등록된 알림 콜백을 호출한다
4. IF 요청에 대한 응답이 타임아웃 내에 도착하지 않으면, THEN THE RPC_Client SHALL 타임아웃 에러를 발생시킨다
5. IF Bridge 프로세스가 예기치 않게 종료되면, THEN THE RPC_Client SHALL 대기 중인 모든 요청을 에러로 거부한다
6. WHEN `stop` 메서드가 호출되면, THE RPC_Client SHALL Bridge 프로세스의 stdin을 닫고 정상 종료를 대기한다

### 요구사항 9: 채널 플러그인 등록 및 설정

**사용자 스토리:** 사용자로서, KakaoTalk 채널을 OpenClaw에 등록하고 설정하길 원한다. 이를 통해 KakaoTalk을 통한 AI 대화를 활성화할 수 있다.

#### 인수 조건

1. WHEN Extension이 로드되면, THE Extension SHALL OpenClaw 플러그인 API에 KakaoTalk 채널을 등록한다
2. THE Extension SHALL Zod 스키마로 설정을 검증한다. 설정 항목은 `enabled`, `dmPolicy`, `allowFrom`, `pollIntervalMs`, `bridgePath`를 포함한다
3. WHEN `dmPolicy`가 `"allowlist"`로 설정되면, THE Extension SHALL `allowFrom` 목록에 포함된 대화방 이름에서만 메시지를 수신한다
4. WHEN `dmPolicy`가 `"open"`으로 설정되면, THE Extension SHALL 모든 대화방에서 메시지를 수신한다
5. WHEN `bridgePath`가 설정되지 않으면, THE Extension SHALL 기본값 `"kakaotalk-bridge"`를 사용한다

### 요구사항 10: 게이트웨이 — 인바운드 메시지 처리

**사용자 스토리:** 사용자로서, KakaoTalk으로 받은 메시지가 OpenClaw로 전달되길 원한다. 이를 통해 AI가 KakaoTalk 메시지에 응답할 수 있다.

#### 인수 조건

1. WHEN Gateway가 KakaoTalk 계정을 시작하면, THE Extension SHALL RPC_Client를 생성하고 Bridge 프로세스를 시작한다
2. WHEN Bridge로부터 `new_message` 알림을 수신하면, THE Extension SHALL 메시지를 OpenClaw 런타임으로 라우팅한다
3. WHEN 인바운드 메시지를 라우팅할 때, THE Extension SHALL 발신자 ID, 메시지 텍스트, 채널 식별자를 포함한다
4. IF Bridge 프로세스가 비정상 종료되면, THEN THE Extension SHALL 에러를 로깅하고 상태를 업데이트한다

### 요구사항 11: 아웃바운드 메시지 전송

**사용자 스토리:** 사용자로서, AI 응답이 KakaoTalk 대화방으로 전송되길 원한다. 이를 통해 자연스러운 대화 흐름을 유지할 수 있다.

#### 인수 조건

1. WHEN 아웃바운드 메시지 전송이 요청되면, THE Extension SHALL RPC_Client를 통해 Bridge의 `send_message` 메서드를 호출한다
2. WHEN 메시지 전송 대상을 지정할 때, THE Extension SHALL 대화방 이름을 사용한다
3. IF 메시지 전송이 실패하면, THEN THE Extension SHALL 에러를 포함하는 전송 결과를 반환한다

### 요구사항 12: 상태 프로브

**사용자 스토리:** 사용자로서, KakaoTalk 채널의 연결 상태를 확인하길 원한다. 이를 통해 문제를 빠르게 파악할 수 있다.

#### 인수 조건

1. WHEN 상태 프로브가 요청되면, THE Extension SHALL RPC_Client를 통해 Bridge의 `check_status` 메서드를 호출한다
2. WHEN 프로브 결과를 반환할 때, THE Extension SHALL `ok` 불리언과 선택적 에러 메시지를 포함한다
3. IF Bridge 프로세스에 연결할 수 없으면, THEN THE Extension SHALL `ok: false`와 연결 실패 에러를 반환한다

### 요구사항 13: 플랫폼 제약

**사용자 스토리:** 사용자로서, macOS가 아닌 환경에서 명확한 안내를 받길 원한다. 이를 통해 지원되지 않는 환경에서의 혼란을 방지할 수 있다.

#### 인수 조건

1. WHEN macOS가 아닌 플랫폼에서 Extension이 로드되면, THE Extension SHALL 채널을 비활성 상태로 등록하고 플랫폼 미지원 경고를 로깅한다
2. WHEN macOS가 아닌 플랫폼에서 Gateway 시작이 요청되면, THE Extension SHALL 시작을 건너뛰고 플랫폼 미지원 메시지를 반환한다
