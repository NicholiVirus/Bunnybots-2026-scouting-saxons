# Harvest Havoc rules — verification log

**Verified:** 2026-11-22 against *Blair Bunnybots 2026 Game Manual v1.5* (Oct 4 2026, incl. Team Updates 00–05).
**Event site check (robot.mbhs.edu/bunnybots, 2026-11-22):** lists "2026 Game Manual v1.5" and "2026 Team Update 05" — **no Team Update 06+**. Roster on site: 24 teams, last updated 11/05.

All numbers live in [`src/game/harvestHavoc.config.ts`](../src/game/harvestHavoc.config.ts). If a newer Team Update changes anything, edit that one file.

| Rule | Manual (v1.5) | Config key |
|---|---|---|
| Match 2:30 = Auto 15 s + Teleop 135 s; Endgame = last 20 s | p.3, p.19–20 | `timing` |
| Pantry L3/L2/L1: carrot 5/4/3, cake 12/10/8; Oven carrot 2, cake **1** | p.18 | `points.pantry`, `points.oven` |
| Taxi 2 / robot (auto); Park 2; Haul carrot 1, cake 3 (while parked, ≤3 pieces) | p.17–18 | `points`, `haul` |
| Shelf holds 5; if more, the 5 **lowest-value** count | p.16 | `pantry` |
| ≤3 pieces controlled per robot (G14) | p.28 | `carryLimit` |
| 24 carrots/alliance (5 prestaged, 2 preload/robot); 10 cakes/alliance = 1 prestaged + **9 at the opposing Depot (trade only)** | p.12 | `supply` |
| 3 oven carrots → 1 cake from the opposing Depot; free handover when empty; oven cakes recycle | p.22 | `cakeEconomy` |
| RP: Win 3 / Tie 1 / Loss 0; Stocked ≥3 per shelf; Baked ≥1 cake per shelf; Dinner ≥10 endgame pts | p.19 | `rankingPoints` |
| Rank = avg RP; tiebreakers W-L → cumulative alliance score → random | p.37 | `ranking` |
| Quals attendance optional → "No Show" is real | p.37 | `ranking.qualAttendanceOptional` |
| DQ = 0 match pts + 0 RP (quals) | p.23 | `ranking.disqualifiedGetsZero` |
| Up to 8 alliances (FRC 10.6.6), serpentine selection (10.6.1), backups in rank order | p.37 | `playoffs` |
| Double-elim 1v8/2v7/3v6/4v5; finals inside the bracket (lower-bracket alliance carries its loss); byes for missing alliances | p.37–38 | `playoffs` |
| Playoff ties: fewer MAJOR fouls → Pantry pts → Oven pts → replay | p.37–38 | `playoffs.tiebreakers` |
| Fouls: minor 4 / major 8, credited to the opponent | p.23 | `points.foul` |
| Robot: perimeter ≤120", start height ≤48", extension ≤18", ≤115 lb (no battery/bumpers), ≤135 lb with bumpers, ≥0.5" clearance | p.31–32 | `robotLimits` |
| Hotspots/routers banned in the event area (E6) | p.34 | (architecture: offline-first + QR) |

## Notes on 449's data (The Bunnybots Alliance)

- `minor_red` / `major_red` = fouls **committed by red** (their points go to blue).
- Pantry slot strings hold exactly 5 slots per shelf (`1` carrot, `2` cake, `0` empty); haul slots hold 3.
- B robots arrive as `9` + number (`9449` → `449b`); every importer uses the alias map.
- 449's **simulation** scored cakes in the Oven at **2** points (manual: **1**). Importers recompute every score from the config and flag mismatches.
- 449's simulated finals are best-of-3 (`F1`, `F2`, …); the manual says finals are part of the double-elimination bracket. Our bracket simulator follows the manual; the importer accepts any playoff labels.
