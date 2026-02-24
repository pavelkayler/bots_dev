# 09 Project Structure (recommended)

## Repository layout
```
/backend
  /src
    /api
      http.ts        # REST routes
      wsHub.ts       # WS server to frontend
      dto.ts         # DTO types + zod schemas
    /bybit
      BybitWsClient.ts
      topicBuilder.ts
      rest.ts        # instruments-info bootstrap
    /engine
      SessionManager.ts
      UniverseBuilder.ts
      MarketStateStore.ts
      CandleTracker.ts
      FundingCooldownGate.ts
      StrategyEngine.ts
    /paper
      PaperBroker.ts
      rounding.ts
      fees.ts
      funding.ts
      models.ts
    /logging
      EventLogger.ts
    index.ts
  package.json
  tsconfig.json

/frontend
  /src
    /pages
      ConfigPage.tsx
      RuntimePage.tsx
      SymbolsPage.tsx
      EventsPage.tsx
    /components
      AppNavbar.tsx
      SymbolsTable.tsx
      EventsTable.tsx
      StatusBadge.tsx
    /ws
      client.ts
      types.ts
    /state
      store.ts
    App.tsx
    main.tsx
  package.json
  tsconfig.json
```

## Runtime overview
Bybit WS -> MarketStateStore (last values) -> 1Hz Engine -> PaperBroker
                                                  |
                                                  +-> EventLogger (JSONL)
                                                  +-> wsHub (snapshot/tick/events)
Frontend WS client -> state store -> pages/tables
