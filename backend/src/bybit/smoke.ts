import { BybitWsClient } from './BybitWsClient';
import { fetchInstrumentsInfoLinear } from './rest';

async function run(): Promise<void> {
  const symbols = ['BTCUSDT', 'ETHUSDT'];
  const tfMin = 5;

  const specs = await fetchInstrumentsInfoLinear();
  for (const symbol of symbols) {
    console.log('[instrument]', symbol, specs[symbol]);
  }

  const client = new BybitWsClient({
    onTicker(symbol, patch) {
      console.log('[ticker]', symbol, patch);
    },
    onKline(symbol, tf, candle) {
      console.log('[kline]', symbol, tf, candle.close, candle.confirm);
    },
    onError(error) {
      console.error('[ws-error]', error.message);
    },
  });

  client.setSubscriptions({ symbols, tfMin });
  client.start();

  process.on('SIGINT', () => {
    client.stop();
    process.exit(0);
  });
}

run().catch((error) => {
  console.error('[smoke-failed]', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
