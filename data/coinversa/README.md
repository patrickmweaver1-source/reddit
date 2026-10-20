# Coinversa Pulse capture for TRAP Discipline

Data pulled from the Coinversa Pulse connector (Hyperliquid positioning). Public market data only; no account, trade or balance data of yours is in here.

## What is here (captured 2026-10-20 ~11:13 UTC)
- `cohort_bias_1h_<COIN>.csv` : hourly snapshots, 8 profitability tiers, for 16 coins (BTC, ETH, SOL, HYPE, ZEC, NEAR, XRP, PUMP, LIT, DOGE, WLD, ENA, XMR, TRUMP, SUI, AVAX, LINK; the three 2026-10-20 first-look study coins are BTC, ETH, SOL); from 2026-07-22 to 2026-10-20 (89 days, a few hourly gaps: 2,113 of ~2,136 hours). Source tool: `live_cohort_bias_history` (up to 2,160 hours; the other cohort-history tool only reaches 30 days).
- `cohort_bias_4h_<COIN>.csv`, `cohort_bias_24h_<COIN>.csv` : the same series folded into UTC 4-hour and 24-hour buckets (last value, mean, and the number of hourly points). Derived by me from the hourly file; not a separate Coinversa series.
- `cohort_performance_daily.csv` : daily PnL, volume, trades and win rate per tier for the last 30 days.
- **15-minute resolution does not exist in the history.** Coinversa stores hourly snapshots. A 15-minute series can only be recorded live from now on (see "Live capture" below).

## Reading the numbers
- `net_bias` is a ratio from -1 to +1: (long notional - short notional) / (long + short). -0.29 means 29% net short by notional. (The other cohort tool reports percent.)
- Tier names: money_printer = Apex, smart_money = Sharps, grinder = Grinders, humble_earner = Scrapers, exit_liquidity = The Crowd, semi_rekt = Bleeders, full_rekt = Trapped, giga_rekt = Blown Out. Tiers are by ALL-TIME realised PnL, so a wallet's tier uses information from after some of the history it appears in (a look-back-bias risk in any backtest).
- The snapshot time is taken as the moment the snapshot describes. Use a value only for decisions at or after that time.
- Hyperliquid positioning only, not Bybit.

## Frozen test plan (written BEFORE any returns were looked at)
Question: is Coinversa worth paying for? Hypotheses, all one-sided in the direction stated, on BTC, ETH and SOL, horizons 1h, 4h, 24h (27 tests, Benjamini-Hochberg q = 0.10 across all of them):
- H1: (Sharps net_bias - The Crowd net_bias) at hour t is positively related to the return from t to t+h.
- H2: the change in Apex net_bias over the previous 4 hours is positively related to the return from t to t+h.
- H3: (Trapped + Blown Out) net_bias at hour t is negatively related to the return from t to t+h (crowded-short squeezes show up as positive returns after very negative bias, i.e. a negative relation).
Method: signals standardised with the older 60 days' mean and standard deviation; slope with day-clustered (week-clustered for 24h) standard errors; older 60 days find, newer 29 days confirm; then forward test on data recorded after 2026-10-20. Prices: Binance USDT-perpetual hourly candles, return from the open of the hour to the close of the horizon.
Keep-paying rule: pay for Pro only if at least one hypothesis passes in the confirm period AND still has the same sign in the forward period, or if it adds out-of-sample accuracy to the app's own models. Otherwise drop to the Starter plan (the live tools such as live_cohort_bias, the liquidation summary and the coin risk snapshot are Starter; only the history tools are Pro) or cancel. This archive means a downgrade loses little: the 89 days are saved.
Nothing here changes a rule, alert or threshold. Information only.

## Live capture
A scheduled capture (see CAPTURE_LOG.md once started) appends snapshots of live cohort bias, liquidation summary and coin risk to `live_snapshots.jsonl`. Resolution is limited by what a scheduled session can do (about every few hours); a true 15-minute record needs a collector on your own computer.

## First look (2026-10-20, run once on the frozen plan above; `study_v1.py`, `study_v1_result.json`)
27 tests (3 coins x 3 hypotheses x 3 horizons), older 60 days to find, newer ~29 days (purged by the horizon) to confirm, Benjamini-Hochberg q = 0.10.
Result: 0 of 27 passed in the find period and 0 of 27 in the confirm period. The strongest sign-consistent candidate was ETH, Sharps-minus-Crowd, 24-hour horizon (find z +0.56, confirm z +1.59, neither close to the BH cut). That is NOT evidence of an effect: with 89 days of hourly data these tests can only see large effects. Verdict for now: "not enough data to say", not "ruled out". The forward test (data after 2026-10-20) is what counts.
