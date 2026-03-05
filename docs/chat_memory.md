Память чата bots_dev (Bybit USDT-perp)

Дата: 2026-02-27

1. Строгий workflow

СНАЧАЛА читаем docs/ (11_current_state.md, 06_contracts.md, 12_live_rows.md, 13_presets.md, 14_direction_mode.md, 15_apply_and_reboot.md, 17_optimizer.md, 18_stability.md, 20_future_plan.md).

Потом: правка: → в очередь (#1, #2, ...).

Один промт для Codex — только по команде: «Давай промт».

Промт: только EN, минимальные изменения, точные файлы, без лишних фич/рефакторов, без комментариев с @.

После «Готово» со скринами: очередь до этого закрыта, нумерация сбрасывается; ответ ассистента: «Принято, жду правки дальше.»

2. Инварианты (не ломать)

Upstream Bybit PUBLIC WS подключается только в RUNNING.

В STOPPING/STOPPED/PAUSED: upstream закрыт, таймеры отменены, rows=[].

WS фронта к backend — singleton.

signals.requireFundingSign всегда true; UI чекбокс удалён. funding>0 → LONG, funding<0 → SHORT.

Optimizer data source: dataset histories/cache only.

Optimizer: worker_threads, progress 0.01%, pause/resume/cancel, checkpoints+retention, loop (N/infinite)+elapsed, blacklist rememberNegatives + effectiveSeed shift, loop results table кумулятивная (не сбрасывать).

Health: /api/doctor (low disk 2GB), soak /api/soak/last + JSONL раз в 60s при RUNNING.

3. Что сделано в этом чате (ключевое)

Optimizer

Прогресс: backend — source of truth, worker throttling; UI показывает server donePct без локального 0→100.

Большие тейпы: loading phase 0..5% с прогрессом по bytes + yield; затем run-phase прогресс внутри кандидата (sub-progress раз в ~5000 events), чтобы прогресс не “висел”.

UI: отдельные ряды кнопок single/loop, корректный gating; tf selector — только 1..60 мин (без Auto).

Loop results: кумулятивно и стабильно, не откатывается на старую таблицу после stop.

“Completed/Stopped runs”: история ранов с пагинацией/сортировкой, View-expand, positive-only rows, Copy-to-settings в nested.

.gitignore: runtime optimizer artifacts under backend/data/\* (optimizer_blacklists/checkpoints/loops/sessions и т.п.).

Execution modes + Demo

execution.mode: paper | demo | empty (empty = запись тейпов без торговли).

Demo trading (REST-only):

v5 signing + BybitDemoRestClient.

DemoBroker: reconcile polling RUNNING-only, pending entries + timeout cancel, TP/SL, leverage best-effort.

Instruments meta: tickSize/qtyStep/minOrderQty; округления qty/price/TP/SL.

Hedge mode: positionIdx (Buy=1, Sell=2).

orderLinkId <= 36; try/catch — ошибки REST не валят процесс.

Global REST limiter + 10006 backoff/retry-once using X-Bapi-Limit-Reset-Timestamp.

Reconcile uses settleCoin=USDT (убирает 10001 missing params).

GLOBAL vs TRACKED open orders/positions; UI показывает global counts.

Executions polling + dedupe → tradesCount / realizedPnLUsdt / feesUsdt / lastExecTimeMs.

Балансы: start snapshot + current balance polling каждые 60s (cached) + updatedAt.

Demo summary persisted on stop: start/end/delta (+ end counts), endpoints:

GET /api/session/demo-summary

GET /api/session/demo-summary/download

run-pack manifest adds demoSummaryUrl.

Env loading

Node сам .env не читает; добавлен загрузчик .env в реальный backend entrypoint (включая Windows encoding), чтобы demo keys работали.

UI/Doctor

Config: execution mode selector + inline keys/auth indicators + refresh; demo settings card убран.

Doctor demoAuthOk: probe через positions with settleCoin=USDT.

4. Открыто / следующие правки

STOPPING: фронт спамит 404 по /api/session/summary и /api/session/demo-summary → нужен gating: не поллить в RUNNING/STOPPING; 404 трактовать как “нет файла”.

Demo: ограничение “одна позиция на символ” + запрет стакать entry ордера по повторным сигналам.

Иногда keys/auth крестики не совпадают с реальностью → проверить refresh/mapping.

5. Команды

backend: cd backend && npm run dev

frontend: cd frontend && npm run dev

builds: cd backend && npm run build ; cd frontend && npm run build

## Next planned work batch (remote historical cache)

Planned direction:
- Keep optimizer data flow on dataset histories/cache only.
- Introduce Dataset Target (Universe + Range) and a server-side historical cache built from Bybit REST history endpoints.
- Add UI: Universe selector, Range presets/manual datetime, Receive Data (applies selected target) with rate-limit-aware progress.
- Standardize table pagination UI across the app.
- Universe page: remove unused buttons, fix Create 400, add progress, preserve Create state across routing.
- Optimizer: remove single-run controls and manual from/to; use Dataset Target range.


