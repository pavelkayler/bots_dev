# Engine runtime notes

Last update: 2026-02-24

## Universe warm-up
A symbol needs:
- at least one ticker update (mark/OIV/funding)
- at least one candle confirm to establish references

If any data is missing, rows should still exist (with safe defaults),
but `signal` should be null and `reason` should reflect missing refs.
