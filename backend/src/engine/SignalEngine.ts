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
    model?: "oi-momentum-v1" | "signal-multi-factor-v1";
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

        const pTh = Math.max(1e-8, Math.abs(this.cfg.priceThresholdPct));
        const oTh = Math.max(1e-8, Math.abs(this.cfg.oivThresholdPct));
        const model = this.cfg.model ?? "oi-momentum-v1";

        let longMatch = priceMovePct >= pTh && oivMovePct >= oTh;
        let shortMatch = priceMovePct <= -pTh && oivMovePct <= -oTh;

        if (model === "signal-multi-factor-v1") {
            const priceLong = Math.max(0, priceMovePct / pTh);
            const priceShort = Math.max(0, -priceMovePct / pTh);
            const oiLong = Math.max(0, oivMovePct / oTh);
            const oiShort = Math.max(0, -oivMovePct / oTh);
            const fundingNorm = Math.min(1, Math.abs(fundingRate) / 0.001);
            const fundingLong = fundingRate > 0 ? fundingNorm : 0;
            const fundingShort = fundingRate < 0 ? fundingNorm : 0;

            const longScore = priceLong * 0.45 + oiLong * 0.35 + fundingLong * 0.2;
            const shortScore = priceShort * 0.45 + oiShort * 0.35 + fundingShort * 0.2;
            const passScore = 1.0;
            const scoreDelta = 0.2;

            longMatch = longScore >= passScore && longScore >= shortScore + scoreDelta;
            shortMatch = shortScore >= passScore && shortScore >= longScore + scoreDelta;
        }

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
