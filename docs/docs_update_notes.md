Документация: что обновить/проверить в docs/

docs/11_current_state.md:
execution.mode (paper/demo/empty), demo trading REST-only, optimizer progress + большие тейпы, completed runs table, limiter/backoff 10006.

docs/06_contracts.md:
новые endpoints GET /api/session/demo-summary, GET /api/session/demo-summary/download, run-pack demoSummaryUrl, botStats demoStats (global/tracked counts + balances), doctor demoAuthOk probe.

docs/16_summary_ui.md:
demo summary card (start/end/current/delta), правила polling (current balance раз в 60s).

docs/18_stability.md:
rate limiting 10006, глобальная очередь + backoff, reconcile cadence, что делать при 404 summary.

docs/20_future_plan.md:
next: stop 404 gating; one-position-per-symbol; возможно упростить live execution stats если тяжело/неточно.
