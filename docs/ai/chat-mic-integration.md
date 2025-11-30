# Chat + mic integration (Gemini-first)

The assistant APIs now return everything the UI needs to drive Gemini 3.0 (with OpenAI fallback) using the tool registry.

## Core endpoints
- `POST /v1/ai/assistant/sessions` – start a session. Include `agentId`, optional `context`, and `X-Tenant-Id`. Response includes `session`, `greeting`, `agent` metadata, and `toolkit`.
- `POST /v1/ai/assistant/sessions/:id/messages` – append a chat/voice message. Response includes the updated transcript plus an `agent` block containing:
  - `providerRequest`: ready-to-send Gemini/OpenAI request body + URL (tool-calling enabled).
  - `fallbackRequest`: optional OpenAI payload if the primary is down.
  - `promptPackage`: system prompt, guardrails, playbook, context, tools, and tool schemas.
- `POST /v1/ai/assistant/agent-call` – build provider payloads without a session (pass `agentId`, `message`, `context`, `user`).
- `GET /v1/ai/assistant/tools` and `/status` – list providers, tools, profiles, and agents (role-aware).

## Client flow (text or voice)
1) Start session with `agentId` (e.g., `global-assistant`, `inventory-enrichment`) and page/resource context.
2) On user input, call `/messages` with the same `agentId` and `context`.
3) Take `response.agent.providerRequest` and execute it against Gemini using your API key. Handle tool calls per provider spec.
4) Parse any `<COMMAND ...>` blocks in the model reply and dispatch them through the backend command executor (which enforces autopilot and role limits).
5) If the model wants to run a mutating tool marked `requiresConfirmation`, prompt the user before calling the backend route.
6) Stream the model’s final message back into the chat; optionally log observations via `ai_log_observation`.

## Gemini request fields
- `providerRequest.url` – e.g., `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.0-pro:generateContent`
- `providerRequest.body` – already formatted with `contents` and `functionDeclarations` for tools.
- `providerRequest.provider` / `type` – for telemetry.

## Notes
- Gemini 3.0 Pro is default for `global-assistant`, `inventory-enrichment`, and `market-intel`; OpenAI is fallback where defined.
- Tool schemas include `route` and `requiresConfirmation` metadata; respect `allowedRoles` before showing runnable actions.
- Keep fetch usage tight: `ai_web_fetch` should include a purpose and stay within the allowlist enforced server-side.
