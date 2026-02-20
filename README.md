# Bybit USDT-Perpetual Paper Bot — Specification Bundle

**Date:** 2026-02-20  
**Scope:** v1 (Paper only), local server + local UI.

This folder is the single source of truth for:
- Functional requirements and constraints
- Data sources (Bybit WS/REST)
- Strategy logic and paper execution rules
- State machines (session + per-symbol)
- Eventlog format (JSONL)
- Frontend ↔ Backend API/WS message contracts
- Implementation roadmap

## Tech stack (fixed)
- Frontend: **Vite + TypeScript + React + react-bootstrap + react-router-dom**
- Backend: **Node.js** (recommended TS)
- Frontend connects to backend via local WebSocket.
- Backend connects to Bybit via **official Public WebSocket V5**.

## System constraints (fixed)
- Strategy evaluation and backend→frontend updates: **≤ 1 update per second (1Hz)**.
- Market data ingestion: real-time from Bybit WS; backend stores last values but emits to UI at 1Hz.
- Trading universe is built **once at session start**; no universe updates mid-session.
