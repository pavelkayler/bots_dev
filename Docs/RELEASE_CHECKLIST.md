# RELEASE_CHECKLIST.md

## v1 Stable release checklist

- [ ] Build backend
  ```bash
  npm run build --prefix backend
  ```

- [ ] Build frontend
  ```bash
  npm run build --prefix frontend
  ```

- [ ] Run backend selfcheck scenarios (if present)
  ```bash
  npm run selfcheck --prefix backend
  ```

- [ ] Run app live for at least 15 minutes
  - Confirm backend and frontend stay healthy.
  - Confirm no persistent reconnect loop.

- [ ] Verify 1Hz tick behavior
  - Inspect WS stream and ensure tick updates are not faster than ~1/sec.

- [ ] Verify JSONL eventlog writing
  - Check `data/sessions/<sessionId>/events.jsonl` exists.
  - Confirm expected lifecycle events are appended.

- [ ] Verify STOP behavior end-to-end
  - Active entry orders are canceled.
  - Open positions are closed.
  - Session transitions to `STOPPED`.
  - UI symbol updates freeze after stop confirmation.

- [ ] Verify docs are updated and consistent
  - `RUN.md`
  - `OPERATOR_GUIDE.md`
  - `TROUBLESHOOTING.md`
  - `RELEASE_CHECKLIST.md`
