/**
 * Event-specific facts (Blair BunnyBots, Sat Dec 12 2026). Game rules live in
 * src/game/harvestHavoc.config.ts — this file is only about the event + roster.
 */

/** Saxon Robotics (Langley HS): BOTH robots are "ours". */
export const OUR_TEAMS = ['611', '526'] as const;
export type OurTeam = (typeof OUR_TEAMS)[number];
export const OUR_TEAM_NAMES: Record<OurTeam, string> = { '611': 'Saxons', '526': 'Saxon Sparks' };

export const isOurTeam = (id: string | null | undefined): id is OurTeam =>
  !!id && (OUR_TEAMS as readonly string[]).includes(id);

export const EVENT = {
  name: 'Blair BunnyBots 2026',
  game: 'Harvest Havoc',
  date: '2026-12-12',
  venue: 'Montgomery Blair HS, Silver Spring MD',
  host: 'FRC 449 — The Blair Robot Project',
  site: 'https://robot.mbhs.edu/bunnybots',
  /** Local event-day schedule (America/New_York). */
  schedule: [
    { label: 'Quals Part 1', start: '10:15', end: '12:30' },
    { label: 'Lunch', start: '12:30', end: '13:15' },
    { label: 'Quals Part 2', start: '13:15', end: '15:00' },
    { label: 'Alliance selection', start: '15:00', end: '15:15' },
    { label: 'Playoffs', start: '15:15', end: '18:15' },
  ],
  timezone: 'America/New_York',
  /** Default for The Bunnybots Alliance base URL; Admins override it in-app. */
  /** 449's The Bunnybots Alliance (Shiny app); override with NEXT_PUBLIC_TBA_CLONE_URL or Admin → Data sources. */
  defaultTbaUrl: process.env.NEXT_PUBLIC_TBA_CLONE_URL || 'https://blair-robot-449.shinyapps.io/the_bunnybots_alliance',
} as const;

export type TeamStatus = 'confirmed' | 'expected' | 'withdrawn';

export interface RosterTeam {
  id: string;
  name: string;
  status: TeamStatus;
  notes?: string;
}

/**
 * All 28 robots: union of the official site list (24, as of 11/05) and 449's
 * scouting-form list. Admins can add / rename / remove teams at any time.
 */
export const ROSTER: readonly RosterTeam[] = [
  { id: '321', name: 'RoboLancers', status: 'confirmed' },
  { id: '449', name: 'The Blair Robot Project', status: 'confirmed' },
  { id: '449b', name: 'The Blair Robot Project B', status: 'confirmed' },
  { id: '526', name: 'Saxon Sparks (US)', status: 'confirmed' },
  { id: '611', name: 'Saxons (US)', status: 'confirmed' },
  { id: '614', name: 'Night Hawks', status: 'confirmed' },
  { id: '686', name: 'Bovine Intervention', status: 'confirmed' },
  { id: '1599', name: 'CircuiTree', status: 'confirmed' },
  { id: '2106', name: 'The Junkyard Dogs', status: 'confirmed' },
  { id: '2377', name: 'C Company', status: 'confirmed' },
  { id: '2537', name: 'Space RAIDers', status: 'confirmed' },
  { id: '2537b', name: 'Space RAIDers B', status: 'expected' },
  { id: '3504', name: 'Girls of Steel', status: 'confirmed' },
  { id: '4472', name: 'SuperNOVA', status: 'confirmed' },
  { id: '4472b', name: 'SuperNOVA B', status: 'expected' },
  { id: '4575', name: 'Gemini', status: 'confirmed' },
  { id: '4821', name: 'cyberUS', status: 'confirmed' },
  { id: '5115', name: 'Knight Riders', status: 'confirmed' },
  { id: '5243', name: 'Aegis', status: 'confirmed' },
  { id: '5243b', name: 'Aegis B', status: 'expected' },
  { id: '5338', name: 'RoboLoCo', status: 'confirmed' },
  { id: '5338b', name: 'RoboLoCo B', status: 'expected', notes: 'May be the same robot as 5353.' },
  { id: '5353', name: 'LoCo Raptors', status: 'confirmed' },
  { id: '5549', name: 'Gryphon Robotics', status: 'confirmed' },
  { id: '5587', name: 'Titan Robotics', status: 'confirmed' },
  { id: '8230', name: 'KoiBots', status: 'confirmed' },
  { id: '8726', name: 'CryptoHawks', status: 'confirmed' },
  { id: '9033', name: 'Ocebots', status: 'confirmed' },
];

/**
 * The field system encodes B robots as "9" + number (449b → 9449).
 * Every importer runs team ids through this map (Admins can edit it).
 */
export const DEFAULT_ALIASES: Readonly<Record<string, string>> = {
  '9449': '449b',
  '92537': '2537b',
  '94472': '4472b',
  '95243': '5243b',
  '95338': '5338b',
};
