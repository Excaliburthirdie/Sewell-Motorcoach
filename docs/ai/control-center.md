# AI Control Center API surface

Endpoints (admin only)
- `GET /v1/ai-control/evals` – list evals (filter by status/category via query).
- `GET /v1/ai-control/evals/:id` – eval detail.
- `POST /v1/ai-control/evals` – create eval (human/AI-proposed).
- `PUT /v1/ai-control/evals/:id` – update eval.
- `POST /v1/ai-control/evals/:id/activate` / `:id/deprecate` – change status.
- `GET /v1/ai-control/agents` / `GET /v1/ai-control/agents/:id` – agent listing/detail.
- `PUT /v1/ai-control/agents/:id` – update agent settings (tool profiles, provider).
- `GET /v1/ai-control/autopilot` / `PUT /v1/ai-control/autopilot` – manage autopilot max level and enable flag.
- `GET /v1/ai-control/logs` / `GET /v1/ai-control/logs/:id` – AI event logs (eval runs, routing, commands, autopilot).
- Triggers: `POST /v1/ai-control/run-self-test`, `POST /v1/ai-control/run-market-update`, `POST /v1/ai-control/run-daily-briefing`.

What’s logged
- Eval routing decisions, provider requests (metadata), tool/command executions, autopilot runs, and internal traces.
- Use logs to debug prompts, playbooks, and autopilot behavior.

Control knobs
- Adjust `autopilotSettings.maxLevel` to gate writes (level 0 = suggest, 1 = safe autopilot, 2 = writes).
- Update agents to switch providers or tools per tenant.
- Edit evals/playbooks/restrictions to change AI behavior without code changes.
