# Keel screening ledger (every run is a trial; nothing here changes a rule)

Purpose: cheap first screens on Hyperliquid data. A screen that "works" proves nothing; it earns a proper test in the TRAP app on Bybit data with the app's costs, purged train/test splits and false-discovery control. Trials used are counted so the multiple-testing penalty can be applied honestly (Keel plan: 250 runs a week).

| # | Date | Strategy | Idea (written before the run) | Window | Result | Verdict |
|---|------|----------|--------------------------------|--------|--------|---------|
| K1 | 2026-10-20 | trap_k1_funding_fade_daily (str_01m5ch4pc3dc22krehnzyscvsd) | Short the perps whose smoothed (10-day) funding is highest, long the lowest: crowded longs pay and tend to unwind. Top 30 HL perps by volume, daily, 1x gross, costs 4.5 bps fee + 4.5 bps slippage per fill | 2024-07-27 to 2026-10-19 (815 days) | Return -10.4%, Sharpe -0.12, max drawdown -36.5%, win rate 46.3%, profit factor 0.89, turnover 90x. It COLLECTED +$2,312 of funding on $10,000, and lost more than that on price | Does not work as specified; not promoted. 1 trial used |

Planned next (not yet run; freeze wording before running): K2 open-interest crowding regime as a gate on K1 (OpenInterestRegime); K3 perp-premium rich as a fade signal (PremiumRegime); K4 taker-flow momentum on 1h (TakerFlowLoader). Each is one more trial.
