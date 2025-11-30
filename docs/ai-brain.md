# AI Brain overview

The AI Brain is a thin agent layer that sits on top of the existing backend services. It routes requests to OpenAI or Gemini 3, exposes the full backend as AI-ready tools, and packages prompts with tenant/user context so chat + mic surfaces can operate safely.

## What ships in this repo
- **Provider registry** – `aiControl.providers` now seeds two provider types (`openai-primary`, `gemini3-primary`) with type, baseUrl, defaultModel, capabilities, and surfaces.
- **Tool registry + profiles** – Canonical tool definitions live in `aiControl.toolRegistry`; profiles bundle tools by domain (inventory, CRM, SEO, analytics, campaigns, core-data, web-research). `/v1/ai/assistant/tools` reads from this registry.
- **Agents** – `aiControl.agents` defines `global-assistant`, `inventory-enrichment`, `market-intel`, and `lead-hunter`, each with provider/fallback, tool profiles, guardrails, and system prompt templates under `docs/ai/system/*.md`.
- **Default model choice** – Gemini 3.0 Pro is now the primary provider for the global assistant and researcher agents, with OpenAI as fallback where configured.
- **Prompt packaging** – `aiRegistryService.buildPromptPackage()` composes system prompt + guardrails + tool schemas + context. `aiService.buildProviderRequest()` turns that into OpenAI/Gemini tool-calling payloads (not executed here).
- **Web research + observations** – `ai_web_fetch` (wraps `/v1/ai/web-fetch`) and `ai_log_observation` (wraps `/v1/ai/observe`) are registered as tools for research/audit flows.

## How it fits together
1) **Assistant entrypoints** – `/v1/ai/assistant/status` and `/v1/ai/assistant/tools` now return seeded providers, tool profiles, tools, and agents for the active tenant.
2) **Agent selection** – Frontend passes `agentId` (e.g., `global-assistant` or `inventory-enrichment`) when starting sessions. The backend resolves the agent, provider, fallback, tool list, and system prompt template.
3) **Prompt package → provider payload** – `aiAssistantService.prepareAgentCall(agentId, payload, tenantId)` builds a prompt package and produces provider-specific request bodies for OpenAI/Gemini tool calling. Execution/streaming is intentionally left to the caller/UI.
4) **Guardrails** – Mutating tools carry `requiresConfirmation` + allowedRoles; agent guardrails are injected into system prompts; tenant scoping is enforced in registry seeds.

### Chat/mic wiring (API-first flow)
- **Start session** `POST /v1/ai/assistant/sessions` with `agentId`, optional `context`, and `X-Tenant-Id`. Response now includes `agent` info and `toolkit` (providers, tools, profiles, agents).
- **Build provider payload**: either call `POST /v1/ai/assistant/agent-call` with `agentId`, `message`, `context`, `user` or use the `agent` block returned from `/messages` which already contains `providerRequest`, `fallbackRequest`, and `promptPackage`.
- **Execute model call** on the client with your Gemini/OpenAI key using the provided `providerRequest` (Gemini-first by default). Handle tool calls and confirmations in the UI (honor `requiresConfirmation` flags before invoking mutating routes).

## Ready-to-use agents
- **Sewell Brain (global-assistant)** – OpenAI-first, Gemini fallback; full toolset across inventory, CRM, SEO, analytics, campaigns, web research, and core data.
- **Inventory Researcher (inventory-enrichment)** – Gemini-first; playbook to inspect a unit, fetch up to 3 sources, and apply minimal spec patches with sources.
- **Market Scout (market-intel)** – Gemini-first; mixes analytics/campaigns with targeted web fetches to summarize competitor gaps and demand.
- **Lead Hunter (lead-hunter)** – OpenAI-first; ranks leads, summarizes timelines, proposes tasks, and drafts outreach copy without sending it.

## Inventory enrichment flow (example)
1) UI sets `agentId: "inventory-enrichment"` and context `{ page: "inventory-detail", inventoryId: "..." }`.
2) Backend builds prompt package: system prompt + guardrails (`docs/ai/system/inventory-enrichment.md`), tools from profiles (`inventory`, `seo`, `web-research`).
3) Provider payload is produced for Gemini 3 with tool schemas (`get_inventory_unit`, `ai_web_fetch`, `update_inventory_specs`).
4) UI can execute the provider call, present proposed patches, and require confirmation before running mutating tools.

## Voice + chat notes
- Voice settings persist under `aiControl.voiceSettings` via `/v1/ai/assistant/voice`.
- Chat/mic widget continues to use `/v1/ai/assistant/sessions` + `/messages`; responses now include richer toolkit metadata to render quick actions per agent.

## Safety checklist
- Tenant scoping baked into registry seeds; never touch other tenants.
- Mutations marked `requiresConfirmation` should be confirmed in UI before execution.
- Pricing changes are explicitly disallowed in guardrails and prompts.
- Observations can be logged via `ai_log_observation` for auditability.
