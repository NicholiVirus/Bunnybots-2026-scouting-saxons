# Demo data — 449's simulated Harvest Havoc event

Source: [449-Data-Science/The-Bunnybots-Alliance](https://github.com/449-Data-Science/The-Bunnybots-Alliance) `data/` (fetched 2026-11-22, commit 7001eb4), by FRC 449 The Blair Robot Project. The brief describes it as MIT/open; the repo had no LICENSE file at fetch time — confirm with 449 before redistributing outside the team.

- `matches.csv` — 32 qualification matches (full breakdown + slot strings)
- `playoffs.csv` — double-elim bracket M1–M13 + finals
- `alliances.csv` — 8 alliances
- `rankings.csv` — final qual rankings

**Known issue (handled):** the simulation scored cakes in the Oven at 2 points; the manual says 1. The importer recomputes every score from `src/game/harvestHavoc.config.ts` and records a data warning for each mismatch.

The app loads the copies in `public/demo/` (served + cached offline by the service worker).
