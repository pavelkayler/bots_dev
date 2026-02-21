import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import type { EventRow, SessionStartRequest } from '../api/dto';
import { SimFeed, type SimScenario } from '../feed/SimFeed';
import { EventLogger } from '../logging/EventLogger';
import { MarketStateStore } from '../engine/MarketStateStore';
import { CandleTracker } from '../engine/CandleTracker';
import { FundingCooldownGate } from '../engine/FundingCooldownGate';
import { StrategyEngine } from '../engine/StrategyEngine';
import { PaperBroker } from '../paper/PaperBroker';
import type { InstrumentSpecMap } from '../engine/types';
import { assertCondition, assertSequenceInOrder } from './assert';

interface ScenarioExpected {
  majorSequence: string[];
  exitReason?: 'TP' | 'SL';
  expectNoSignals?: boolean;
}

interface SelfcheckScenario extends SimScenario {
  tfMin: number;
  ticks: number;
  config: SessionStartRequest;
  instrumentSpecs: InstrumentSpecMap;
  expected: ScenarioExpected;
}

interface ScenarioReport {
  name: string;
  passed: boolean;
  eventCounts: Record<string, number>;
  finalState: Array<{ symbol: string; orderOpen: boolean; positionOpen: boolean; status: string }>;
  details: string[];
}

function parseArgs(argv: string[]): { all: boolean; scenario?: string } {
  const all = argv.includes('--all');
  const scenarioArg = argv.find((arg) => arg.startsWith('--scenario='));
  return {
    all,
    scenario: scenarioArg?.split('=')[1],
  };
}

function withFakeNow<T>(now: number, fn: () => T): T {
  const original = Date.now;
  Date.now = () => now;
  try {
    return fn();
  } finally {
    Date.now = original;
  }
}

function createEventFactory() {
  let seq = 0;
  return (type: EventRow['type'], symbol: string, data: Record<string, unknown>): EventRow => ({
    id: `evt_${String(++seq).padStart(6, '0')}`,
    ts: Date.now(),
    type,
    symbol,
    data,
  });
}

function loadScenario(filePath: string): SelfcheckScenario {
  return JSON.parse(readFileSync(filePath, 'utf8')) as SelfcheckScenario;
}

async function runScenario(filePath: string): Promise<ScenarioReport> {
  const scenario = loadScenario(filePath);
  const marketStateStore = new MarketStateStore();
  const candleTracker = new CandleTracker(marketStateStore);
  const fundingCooldownGate = new FundingCooldownGate();
  const strategyEngine = new StrategyEngine();
  const paperBroker = new PaperBroker();
  const addEvent = createEventFactory();

  const sessionDir = mkdtempSync(resolve(tmpdir(), 'bots-selfcheck-'));
  const sessionId = `${scenario.name.replace(/\s+/g, '_')}_${Date.now()}`;
  const eventLogger = new EventLogger(sessionDir);
  eventLogger.start(sessionId);

  const events: EventRow[] = [];
  const universe = [...scenario.symbols];
  paperBroker.initialize(universe);

  const feed = new SimFeed(scenario, {
    onTickerPatch: (symbol, patch) => {
      marketStateStore.applyTickerPatch(symbol, patch);
    },
    onKline: (symbol, tfMin, candle) => {
      if (tfMin === scenario.tfMin) {
        candleTracker.onKline(symbol, candle);
      }
    },
  });

  feed.setSubscriptions({ symbols: universe, tfMin: scenario.tfMin, includeKline: true });
  feed.start();

  const details: string[] = [];
  let cooldownActive = false;

  for (let sec = 0; sec < scenario.ticks; sec += 1) {
    const nowTs = scenario.baseTs + sec * 1_000;

    withFakeNow(nowTs, () => {
      feed.tick(sec);

      const marketSnapshot = marketStateStore.snapshot(universe);
      const cooldown = fundingCooldownGate.evaluate(universe, marketSnapshot, scenario.config.fundingCooldown, nowTs);
      cooldownActive = cooldown.isActive;

      const marketBySymbol = new Map<string, { markPrice?: number; fundingRate?: number; nextFundingTimeTs?: number }>();
      for (const symbol of universe) {
        const market = marketSnapshot.get(symbol) ?? marketStateStore.get(symbol);
        if (!market) {
          continue;
        }
        marketBySymbol.set(symbol, {
          markPrice: market.markPrice,
          fundingRate: market.fundingRate,
          nextFundingTimeTs: market.nextFundingTime,
        });
      }

      const brokerEvents = paperBroker.processTick(nowTs, marketBySymbol, scenario.config);
      for (const event of brokerEvents) {
        events.push(addEvent(event.type, event.symbol, event.data));
      }

      if (cooldown.isActive) {
        return;
      }

      for (const symbol of universe) {
        const market = marketSnapshot.get(symbol);
        const candleRef = candleTracker.get(symbol);
        const hasCandleRef =
          candleRef?.prevCandleClose !== undefined && candleRef.prevCandleOivUSDT !== undefined;

        const decision = strategyEngine.evaluate(
          {
            symbol,
            markPrice: market?.markPrice,
            oivUSDT: market?.openInterestValue,
            fundingRate: market?.fundingRate,
            prevCandleClose: candleRef?.prevCandleClose,
            prevCandleOivUSDT: candleRef?.prevCandleOivUSDT,
            isArmed: paperBroker.canArm(symbol, nowTs) && hasCandleRef,
            dataReady:
              market?.fundingRate !== undefined &&
              market?.nextFundingTime !== undefined &&
              !marketStateStore.isDataStale(symbol, nowTs),
            cooldownBlocked: false,
          },
          scenario.config,
        );

        if (!decision || market?.markPrice === undefined) {
          continue;
        }

        const orderEvents = paperBroker.placeEntryOrder({
          symbol,
          side: decision.side,
          markPrice: market.markPrice,
          nowTs,
          config: scenario.config,
          instrument: scenario.instrumentSpecs[symbol],
        });

        if (orderEvents.length > 0) {
          events.push(
            addEvent('signal_fired', symbol, {
              decision: decision.side,
              markPrice: market.markPrice,
              priceMovePct: decision.priceMovePct,
              oivMovePct: decision.oivMovePct,
            }),
          );
          for (const event of orderEvents) {
            events.push(addEvent(event.type, event.symbol, event.data));
          }
        }
      }
    });
  }

  eventLogger.append(events);
  await eventLogger.stop();

  const eventTypes = events.map((event) => event.type);
  assertSequenceInOrder(eventTypes, scenario.expected.majorSequence, scenario.name);

  if (scenario.expected.expectNoSignals) {
    assertCondition(!eventTypes.includes('signal_fired'), `${scenario.name}: expected no signal_fired events`);
  }

  for (const symbol of universe) {
    let activeState: 'IDLE' | 'ORDER_PLACED' | 'POSITION_OPEN' = 'IDLE';
    let closedAt: number | null = null;

    for (const event of events.filter((item) => item.symbol === symbol)) {
      if (event.type === 'order_placed') {
        assertCondition(activeState === 'IDLE', `${scenario.name}:${symbol}: order placed while state ${activeState}`);
        if (closedAt !== null) {
          assertCondition(event.ts - closedAt >= 1_000, `${scenario.name}:${symbol}: re-arm delay violated`);
        }
        activeState = 'ORDER_PLACED';
      }
      if (event.type === 'order_filled') {
        assertCondition(activeState === 'ORDER_PLACED', `${scenario.name}:${symbol}: filled without open order`);
      }
      if (event.type === 'position_opened') {
        activeState = 'POSITION_OPEN';
      }
      if (event.type === 'position_closed') {
        activeState = 'IDLE';
        closedAt = event.ts;
      }
      if (event.type === 'order_expired' || event.type === 'order_canceled') {
        activeState = 'IDLE';
        closedAt = event.ts;
      }
    }
  }

  const closed = events.filter((event) => event.type === 'position_closed');
  for (const event of closed) {
    const side = String(event.data.side);
    const reason = String(event.data.reason);
    const roiPct = Number(event.data.roiPct ?? 0);

    if (reason === 'TP') {
      assertCondition(roiPct > 0, `${scenario.name}: TP must have positive ROI`);
    }
    if (reason === 'SL') {
      assertCondition(roiPct < 0, `${scenario.name}: SL must have negative ROI`);
    }
    if (scenario.expected.exitReason) {
      assertCondition(reason === scenario.expected.exitReason, `${scenario.name}: expected exit ${scenario.expected.exitReason}, got ${reason}`);
    }
    assertCondition(side === 'LONG' || side === 'SHORT', `${scenario.name}: invalid side ${side}`);
  }

  const eventsFile = resolve(sessionDir, sessionId, 'events.jsonl');
  const jsonlLines = readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean);
  assertCondition(jsonlLines.length === events.length, `${scenario.name}: jsonl line count mismatch`);

  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
  }

  const finalState = universe.map((symbol) => ({
    symbol,
    orderOpen: Boolean(paperBroker.getOrder(symbol)),
    positionOpen: Boolean(paperBroker.getPosition(symbol)),
    status: paperBroker.getSymbolStatus(symbol, true, scenario.baseTs + scenario.ticks * 1_000),
  }));

  details.push(`cooldown_active_at_end=${cooldownActive}`);
  details.push(`events_jsonl=${eventsFile}`);

  rmSync(sessionDir, { recursive: true, force: true });

  return {
    name: scenario.name,
    passed: true,
    eventCounts: counts,
    finalState,
    details,
  };
}

async function main(): Promise<void> {
  const runtimeProcess = (globalThis as any).process;
  const args = parseArgs(runtimeProcess.argv.slice(2));
  const feedMode = runtimeProcess.env.FEED_MODE;
  if (feedMode && feedMode !== 'sim') {
    throw new Error(`selfcheck requires FEED_MODE=sim, received ${feedMode}`);
  }
  const scenariosDir = resolve('testdata', 'scenarios');
  const scenarioFiles = readdirSync(scenariosDir)
    .filter((name: string) => name.endsWith('.json'))
    .sort();

  const envScenario = runtimeProcess.env.SCENARIO;
  const selected = args.all
    ? scenarioFiles
    : args.scenario
      ? [args.scenario]
      : envScenario
        ? [envScenario]
        : scenarioFiles;

  let failures = 0;
  for (const file of selected) {
    const fullPath = resolve(scenariosDir, file);
    try {
      const report = await runScenario(fullPath);
      console.log(`[PASS] ${report.name}`);
      console.log(`  events: ${JSON.stringify(report.eventCounts)}`);
      console.log(`  final: ${JSON.stringify(report.finalState)}`);
    } catch (error) {
      failures += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[FAIL] ${file}: ${message}`);
    }
  }

  if (failures > 0) {
    (globalThis as any).process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  (globalThis as any).process.exit(1);
});
