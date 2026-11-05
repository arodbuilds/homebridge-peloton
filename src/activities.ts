/**
 * The one table of activities (SPEC section 4.2): the plugin's own activity ids, which config.json
 * stores and the Activities chips offer, each with the name the plugin shows for it and the Peloton
 * fitness_discipline values it matches. Workout trigger matching (src/poller/rules.ts), config
 * validation (src/config.ts), the info log lines, and the Devices seen rows read from here.
 *
 * The disciplines were observed on the maintainer's account on November 5, 2026: GET /api/me
 * returned workout_counts with these twelve slugs, and the slug is the workout's fitness_discipline.
 * Three of the plugin's ids differ from Peloton's slug (rowing is caesar, tread_bootcamp is circuit,
 * row_bootcamp is caesar_bootcamp); the ids stay as they are so every saved config keeps working.
 * Names are in sentence case, so Peloton's "Bike Bootcamp" shows as "Bike bootcamp".
 */

export interface Activity {
  /** The plugin's activity id, as config.json stores it. */
  id: string;
  /** The name the plugin shows for the activity and for each of its disciplines. */
  name: string;
  /** The Peloton fitness_discipline values a trigger restricted to this activity matches. */
  disciplines: readonly string[];
}

/** Every activity, in the order of the Activities chips on the settings page. */
export const ACTIVITIES: readonly Activity[] = [
  { id: 'cycling', name: 'Cycling', disciplines: ['cycling'] },
  { id: 'running', name: 'Running', disciplines: ['running'] },
  { id: 'walking', name: 'Walking', disciplines: ['walking'] },
  { id: 'rowing', name: 'Rowing', disciplines: ['caesar'] },
  { id: 'strength', name: 'Strength', disciplines: ['strength'] },
  { id: 'yoga', name: 'Yoga', disciplines: ['yoga'] },
  { id: 'stretching', name: 'Stretching', disciplines: ['stretching'] },
  { id: 'meditation', name: 'Meditation', disciplines: ['meditation'] },
  { id: 'cardio', name: 'Cardio', disciplines: ['cardio'] },
  { id: 'bike_bootcamp', name: 'Bike bootcamp', disciplines: ['bike_bootcamp'] },
  { id: 'tread_bootcamp', name: 'Tread bootcamp', disciplines: ['circuit'] },
  { id: 'row_bootcamp', name: 'Row bootcamp', disciplines: ['caesar_bootcamp'] },
];

/** The plugin's activity ids, in chip order. */
export const ACTIVITY_IDS: readonly string[] = ACTIVITIES.map((activity) => activity.id);

const BY_ID = new Map<string, Activity>(ACTIVITIES.map((activity) => [activity.id, activity]));
const BY_DISCIPLINE = new Map<string, Activity>(
  ACTIVITIES.flatMap((activity) => activity.disciplines.map((discipline) => [discipline, activity] as const)),
);

/**
 * The plugin's activity id for a value written in config: the id itself, or the id whose activity
 * covers a Peloton slug written by hand (caesar is rowing). undefined for anything else.
 */
export function activityIdOf(value: string): string | undefined {
  return BY_ID.get(value)?.id ?? BY_DISCIPLINE.get(value)?.id;
}

/** True when the fitness_discipline belongs to an activity in the table. */
export function isKnownDiscipline(discipline: string): boolean {
  return BY_DISCIPLINE.has(discipline);
}

/** The name the plugin shows for a fitness_discipline ("Rowing" for caesar), or the raw value when it is unknown. */
export function disciplineName(discipline: string): string {
  return BY_DISCIPLINE.get(discipline)?.name ?? discipline;
}

/**
 * True when a trigger restricted to the activity id matches a workout of this fitness_discipline.
 * An id in the table matches only the disciplines in its row, so rowing matches caesar and never a
 * literal "rowing". An entry outside the table keeps its 1.0.3 behaviour and matches a discipline
 * equal to it as written; an unknown discipline matches no id in the table.
 */
export function activityMatches(activityId: string, discipline: string): boolean {
  const activity = BY_ID.get(activityId);
  return activity === undefined ? discipline === activityId : activity.disciplines.includes(discipline);
}
