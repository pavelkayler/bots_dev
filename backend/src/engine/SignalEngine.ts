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
    oiMovePct: number | null;
    fundingRate: number; // can be negative
    cooldownActive: boolean;
    cvdDelta?: number | null;
    cvdImbalanceRatio?: number | null;
    divergencePriceUpCvdDown?: boolean;
    divergencePriceDownCvdUp?: boolean;
};

export type SignalConfig = {
    priceMovePct?: number; // e.g. 0.3 means 0.3%
    oiMovePct?: number;   // e.g. 0.3 means 0.3%
    priceThresholdPct?: number;
    oivThresholdPct?: number;
    requireFundingSign: boolean;
    cvdMoveThreshold?: number;
    requireCvdDivergence?: boolean;
    requireFundingExtreme?: boolean;
    fundingMinAbsPct?: number;
    directionMode?: "both" | "long" | "short";
    model?: "oi-momentum-v1" | "signal-multi-factor-v1";
};

export class SignalEngine {
    private readonly cfg: SignalConfig;

    constructor(cfg: SignalConfig) {
        this.cfg = cfg;
    }

    decide(input: SignalInput): SignalDecision {
        const { priceMovePct, oiMovePct, fundingRate, cooldownActive } = input;

        if (priceMovePct == null || oiMovePct == null) {
            return { signal: null, reason: "no_refs" };
        }

        if (cooldownActive) {
            return { signal: null, reason: "cooldown" };
        }

        const pTh = Math.max(1e-8, Math.abs(this.cfg.priceMovePct ?? this.cfg.priceThresholdPct ?? 0));
        const oTh = Math.max(1e-8, Math.abs(this.cfg.oiMovePct ?? this.cfg.oivThresholdPct ?? 0));
        const model = this.cfg.model ?? "oi-momentum-v1";

        let longMatch = priceMovePct >= pTh && oiMovePct >= oTh;
        let shortMatch = priceMovePct <= -pTh && oiMovePct <= -oTh;

        if (model === "signal-multi-factor-v1") {
            const priceLong = Math.max(0, priceMovePct / pTh);
            const priceShort = Math.max(0, -priceMovePct / pTh);
            const oiLong = Math.max(0, oiMovePct / oTh);
            const oiShort = Math.max(0, -oiMovePct / oTh);
            const fundingThreshold = Math.max(0, Math.abs(this.cfg.fundingMinAbsPct ?? 0));
            const fundingNorm = fundingThreshold > 0 ? Math.min(1, Math.abs(fundingRate) / fundingThreshold) : 1;
            const fundingLong = fundingRate > 0 ? fundingNorm : 0;
            const fundingShort = fundingRate < 0 ? fundingNorm : 0;
            const cvdThreshold = Math.max(0, Math.abs(this.cfg.cvdMoveThreshold ?? 0));
            const cvdDelta = Number(input.cvdDelta);
            const cvdImbalance = Number(input.cvdImbalanceRatio);
            const cvdLongRaw = Number.isFinite(cvdDelta)
                ? cvdDelta
                : (Number.isFinite(cvdImbalance) ? cvdImbalance : 0);
            const cvdShortRaw = -cvdLongRaw;
            const cvdLong = cvdThreshold > 0 ? Math.max(0, cvdLongRaw / cvdThreshold) : (cvdLongRaw > 0 ? 1 : 0);
            const cvdShort = cvdThreshold > 0 ? Math.max(0, cvdShortRaw / cvdThreshold) : (cvdShortRaw > 0 ? 1 : 0);

            const longScore = priceLong * 0.4 + oiLong * 0.3 + cvdLong * 0.2 + fundingLong * 0.1;
            const shortScore = priceShort * 0.4 + oiShort * 0.3 + cvdShort * 0.2 + fundingShort * 0.1;
            const passScore = 1.0;
            const scoreDelta = 0.2;

            longMatch = longScore >= passScore && longScore >= shortScore + scoreDelta;
            shortMatch = shortScore >= passScore && shortScore >= longScore + scoreDelta;

            if (longMatch || shortMatch) {
                const requireFundingExtreme = Boolean(this.cfg.requireFundingExtreme ?? this.cfg.requireFundingSign);
                if (requireFundingExtreme && Math.abs(fundingRate) < fundingThreshold) {
                    return { signal: null, reason: "funding_mismatch" };
                }
                if (requireFundingExtreme) {
                    if (longMatch && fundingRate <= 0) return { signal: null, reason: "funding_mismatch" };
                    if (shortMatch && fundingRate >= 0) return { signal: null, reason: "funding_mismatch" };
                }
                const requireCvdDivergence = Boolean(this.cfg.requireCvdDivergence ?? false);
                const divergenceLong = Boolean(input.divergencePriceDownCvdUp);
                const divergenceShort = Boolean(input.divergencePriceUpCvdDown);
                if (requireCvdDivergence) {
                    if (longMatch && !divergenceLong) return { signal: null, reason: "threshold_not_met" };
                    if (shortMatch && !divergenceShort) return { signal: null, reason: "threshold_not_met" };
                } else if (cvdThreshold > 0) {
                    if (longMatch && cvdLongRaw < cvdThreshold) return { signal: null, reason: "threshold_not_met" };
                    if (shortMatch && cvdShortRaw < cvdThreshold) return { signal: null, reason: "threshold_not_met" };
                }
            }
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
