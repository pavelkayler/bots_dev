export type SignalSide = "LONG" | "SHORT";

export type SignalDecision = {
    signal: SignalSide | null;
    reason:
        | "no_refs"
        | "cooldown"
        | "funding_mismatch"
        | "threshold_not_met"
        | "ok_long"
        | "ok_short";
};

export type SignalInput = {
    priceMovePct: number | null;
    oivMovePct: number | null;
    fundingRate: number; // can be negative
    cooldownActive: boolean;
};

export type SignalConfig = {
    priceThresholdPct: number; // e.g. 0.3 means 0.3%
    oivThresholdPct: number;   // e.g. 0.3 means 0.3%
    requireFundingSign: boolean;
    directionMode?: "both" | "long" | "short";
};

export class SignalEngine {
    private readonly cfg: SignalConfig;

    constructor(cfg: SignalConfig) {
        this.cfg = cfg;
    }

    decide(input: SignalInput): SignalDecision {
        const { priceMovePct, oivMovePct, fundingRate, cooldownActive } = input;

        if (priceMovePct == null || oivMovePct == null) {
            return { signal: null, reason: "no_refs" };
        }

        if (cooldownActive) {
            return { signal: null, reason: "cooldown" };
        }

        const pTh = Math.abs(this.cfg.priceThresholdPct);
        const oTh = Math.abs(this.cfg.oivThresholdPct);

        const longMatch = priceMovePct >= pTh && oivMovePct >= oTh;
        const shortMatch = priceMovePct <= -pTh && oivMovePct <= -oTh;

        if (!longMatch && !shortMatch) {
            return { signal: null, reason: "threshold_not_met" };
        }

        if (this.cfg.requireFundingSign) {
            if (longMatch && fundingRate <= 0) return { signal: null, reason: "funding_mismatch" };
            if (shortMatch && fundingRate >= 0) return { signal: null, reason: "funding_mismatch" };
        }

        const directionMode = this.cfg.directionMode ?? "both";

        if (longMatch) {
            if (directionMode === "short") return { signal: null, reason: "threshold_not_met" };
            return { signal: "LONG", reason: "ok_long" };
        }
        if (directionMode === "long") return { signal: null, reason: "threshold_not_met" };
        return { signal: "SHORT", reason: "ok_short" };
    }
}
