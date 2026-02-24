export const CONFIG = {
    bybit: {
        wsUrl: "wss://stream.bybit.com/v5/public/linear"
    },

    symbols: ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const,

    klineTfMin: 1,

    fundingCooldown: {
        beforeMin: 5,
        afterMin: 5
    },

    signals: {
        priceThresholdPct: 0.01,
        oivThresholdPct: 0.01,
        requireFundingSign: true
    },

    paper: {
        enabled: true,

        marginUSDT: 10,
        leverage: 5,

        entryOffsetPct: 0.02,
        entryTimeoutSec: 30,

        tpRoiPct: 2.0,
        slRoiPct: 2.5,

        makerFeeRate: 0.0002,
        applyFunding: true,

        rearmDelayMs: 1000
    }
};