# kiro-openai-proxy

`kiro-cli`를 OpenAI-compatible API 서버로 감싸서 OpenClaw의 LLM 프로바이더로 사용할 수 있게 해주는 프록시입니다.

## 구조

```
OpenClaw (WhatsApp/Telegram/WebChat 등)
    │
    ▼  POST /v1/chat/completions
kiro-openai-proxy (:18800)
    │
    ▼  ACP (stdio ndjson)
kiro-cli acp
    │
    ▼
Kiro 백엔드 (AWS)
```

## 사용법

```bash
# 1. 프록시 시작
cd kiro-proxy
node server.mjs

# 2. OpenClaw 설정
openclaw config set models.providers.kiro.baseUrl "http://127.0.0.1:18800/v1"
openclaw config set models.providers.kiro.apiKey "dummy"
openclaw config set models.providers.kiro.api "openai-completions"
openclaw config set agent.model "kiro/kiro-default"

# 3. OpenClaw Gateway 시작
openclaw gateway --port 18789 --verbose
```

## 환경변수

- `KIRO_PROXY_PORT` — 프록시 포트 (기본: 18800)
- `KIRO_CMD` — kiro-cli 경로 (기본: kiro-cli)
