/**
 * Typed wrappers for the Peloton member API calls (SPEC section 4.2): me, subscriptions, the
 * latest workout, one workout by id, and the performance graph.
 * Each takes an access token and a fetch implementation, and never stores either.
 * Returned objects contain only the fields SPEC lists.
 */

export const PELOTON_API_BASE = 'https://api.onepeloton.com';

/**
 * Non-2xx response from the Peloton API. status 401 tells the caller to refresh and retry.
 * Never carries the response body.
 */
export class ApiError extends Error {
  public readonly status: number;
  public readonly path: string;

  constructor(status: number, path: string) {
    super(`Peloton API ${path} returned HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.path = path;
  }
}

export interface HeartRateZone {
  /** Zone number 1 to 5, derived from slug or position. */
  zone: number;
  slug: string;
  minValue: number;
  maxValue: number;
}

export interface PairedDevice {
  id?: string;
  name?: string;
}

export interface Me {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  imageUrl: string;
  isProfileImageDefault: boolean;
  /** Empty when the member has not customised zones. */
  customizedHeartRateZones: HeartRateZone[];
  defaultMaxHeartRate: number | null;
  customizedMaxHeartRate: number | null;
  pairedDevices: PairedDevice[];
  /** Epoch seconds, null when the member has never worked out. */
  lastWorkoutAt: number | null;
}

export interface SharedUser {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  imageUrl: string;
  isProfileImageDefault: boolean;
  lastWorkoutAt: number | null;
}

export interface AttachedDevice {
  /** Empty when the entry carries no id; the connect flow then keys the device by its name. */
  id: string;
  name: string;
  /** Hardware model code when the entry carries device_type; the device map (SPEC section 8.3) is learned from it. */
  deviceType?: string;
}

export interface Subscription {
  id: string;
  /** "active_normal" or "unused". */
  status: string;
  ownerId: string;
  maxSharedUsers: number;
  sharedUsers: SharedUser[];
  attachedDevices: AttachedDevice[];
}

export type WorkoutStatus = 'IN_PROGRESS' | 'COMPLETE' | string;

/** The class or free ride a workout was taken against, from the ride object on the workout. */
export interface WorkoutRide {
  id: string;
  title: string;
  /** Planned length in seconds, null when absent. */
  duration: number | null;
  /** Present on instructor-led classes, absent on free rides and imports. */
  instructorId?: string;
}

/**
 * A workout as the list and the single-workout call return it (both carry the same fields).
 * Workouts carry no device id field (confirmed by the build 2 Pi probe, SPEC section 15 item 1):
 * device_type is the hardware model code (home_bike_plus, iOS, and so on), not an identifier of
 * the member's unit, so device matching maps it to attached_devices (SPEC section 8.3).
 */
export interface Workout {
  id: string;
  status: WorkoutStatus;
  fitnessDiscipline: string;
  /** Hardware model code, not a device id. */
  deviceType: string;
  workoutType: string;
  /** Epoch seconds. */
  startTime: number | null;
  endTime: number | null;
  /** Epoch seconds. The latest workout's created_at is the source for "last workout" (SPEC section 4.2). */
  createdAt: number | null;
  title: string;
  name: string;
  /** True for workouts recorded on Peloton hardware or apps. */
  isPelotonOriginatedWorkout: boolean;
  /**
   * True for workouts synced in from a third-party fitness feed (Apple Health, Strava, Fitbit).
   * These are ignored for detection (SPEC section 8.2).
   */
  is3pFitFeedWorkout: boolean;
  /** Platform the workout was recorded on, as Peloton names it. */
  platform: string;
  /** Peloton's own workout identifier when present, otherwise empty. */
  pelotonId: string;
  /** The ride or class, null when the workout carries none. */
  ride: WorkoutRide | null;
}

export interface HeartRateMetric {
  /** Latest sample in values[], null when the metric has no numeric samples yet. */
  latestSample: number | null;
  /** Zone bounds when the metric carries them, otherwise empty. */
  zones: HeartRateZone[];
}

export interface PerformanceGraph {
  /** null when the workout has no heart_rate metric. */
  heartRate: HeartRateMetric | null;
  /** Sample offsets in seconds, one per value in each metric's values[]. The last one is the latest sample. */
  secondsSincePedalingStart: number[];
}

type FetchImpl = typeof fetch;
type Json = Record<string, unknown>;

/** GET /api/me */
export async function getMe(accessToken: string, fetchImpl: FetchImpl = fetch): Promise<Me> {
  const json = await getJson('/api/me', accessToken, fetchImpl);
  return {
    id: idStr(json.id),
    username: str(json.username),
    firstName: str(json.first_name),
    lastName: str(json.last_name),
    imageUrl: str(json.image_url),
    isProfileImageDefault: json.is_profile_image_default === true,
    customizedHeartRateZones: parseZones(json.customized_heart_rate_zones),
    defaultMaxHeartRate: num(json.default_max_heart_rate),
    customizedMaxHeartRate: num(json.customized_max_heart_rate),
    pairedDevices: arr(json.paired_devices).map((device) => {
      const record = obj(device);
      const result: PairedDevice = {};
      if (typeof record.id === 'string') {
        result.id = record.id;
      }
      if (typeof record.name === 'string') {
        result.name = record.name;
      }
      return result;
    }),
    lastWorkoutAt: num(json.last_workout_at),
  };
}

/** GET /api/user/{id}/subscriptions */
export async function getSubscriptions(userId: string, accessToken: string, fetchImpl: FetchImpl = fetch): Promise<Subscription[]> {
  const json = await getJson(`/api/user/${encodeURIComponent(userId)}/subscriptions`, accessToken, fetchImpl);
  return arr(json.data).map((entry) => {
    const record = obj(entry);
    return {
      id: str(record.id),
      status: str(record.status),
      ownerId: idStr(obj(record.owner).id),
      maxSharedUsers: num(record.max_shared_users) ?? 0,
      sharedUsers: arr(record.shared_user_set).map((user) => {
        const shared = obj(user);
        return {
          id: idStr(shared.id),
          username: str(shared.username),
          firstName: str(shared.first_name),
          lastName: str(shared.last_name),
          imageUrl: str(shared.image_url),
          isProfileImageDefault: shared.is_profile_image_default === true,
          lastWorkoutAt: num(shared.last_workout_at),
        };
      }),
      // An entry with neither an id nor a name is nothing the settings page could show; the rest are
      // kept, a numeric id as its decimal string, so no device on the membership is dropped here.
      attachedDevices: arr(record.attached_devices).map((device) => {
        const attached = obj(device);
        const result: AttachedDevice = { id: idStr(attached.id), name: str(attached.name) };
        if (typeof attached.device_type === 'string' && attached.device_type.length > 0) {
          result.deviceType = attached.device_type;
        }
        return result;
      }).filter((device) => device.id.length > 0 || device.name.length > 0),
    };
  });
}

/** GET /api/user/{id}/workouts?limit=1&sort_by=-created. Returns null when the member has no workouts. */
export async function getLatestWorkout(userId: string, accessToken: string, fetchImpl: FetchImpl = fetch): Promise<Workout | null> {
  const json = await getJson(`/api/user/${encodeURIComponent(userId)}/workouts?limit=1&sort_by=-created`, accessToken, fetchImpl);
  const first = arr(json.data)[0];
  if (first === undefined) {
    return null;
  }
  return parseWorkout(obj(first));
}

/**
 * GET /api/workout/{id}. The same shape as one entry of the workouts list. While locked on a
 * workout the poller reads its status here rather than from the list, so a synced import
 * arriving mid-workout cannot end it (SPEC section 8.2).
 */
export async function getWorkout(workoutId: string, accessToken: string, fetchImpl: FetchImpl = fetch): Promise<Workout> {
  const json = await getJson(`/api/workout/${encodeURIComponent(workoutId)}`, accessToken, fetchImpl);
  return parseWorkout(json);
}

function parseWorkout(record: Json): Workout {
  return {
    id: str(record.id),
    status: str(record.status),
    fitnessDiscipline: str(record.fitness_discipline),
    deviceType: str(record.device_type),
    workoutType: str(record.workout_type),
    startTime: num(record.start_time),
    endTime: num(record.end_time),
    createdAt: num(record.created_at),
    title: str(record.title),
    name: str(record.name),
    isPelotonOriginatedWorkout: record.is_peloton_originated_workout === true,
    is3pFitFeedWorkout: record.is_3p_fit_feed_workout === true,
    platform: str(record.platform),
    pelotonId: str(record.peloton_id),
    ride: parseRide(record.ride),
  };
}

function parseRide(value: unknown): WorkoutRide | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Json;
  const ride: WorkoutRide = {
    id: str(record.id),
    title: str(record.title),
    duration: num(record.duration),
  };
  if (typeof record.instructor_id === 'string' && record.instructor_id.length > 0) {
    ride.instructorId = record.instructor_id;
  }
  return ride;
}

/** GET /api/workout/{id}/performance_graph?every_n={everyN} */
export async function getPerformanceGraph(
  workoutId: string,
  everyN: number,
  accessToken: string,
  fetchImpl: FetchImpl = fetch,
): Promise<PerformanceGraph> {
  const path = `/api/workout/${encodeURIComponent(workoutId)}/performance_graph?every_n=${encodeURIComponent(String(everyN))}`;
  const json = await getJson(path, accessToken, fetchImpl);
  const metric = arr(json.metrics).map(obj).find((entry) => entry.slug === 'heart_rate');
  let heartRate: HeartRateMetric | null = null;
  if (metric !== undefined) {
    const samples = arr(metric.values).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    heartRate = {
      latestSample: samples.length === 0 ? null : (samples[samples.length - 1] ?? null),
      zones: parseZones(metric.zones),
    };
  }
  return {
    heartRate,
    secondsSincePedalingStart: arr(json.seconds_since_pedaling_start).filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value),
    ),
  };
}

/* ------------------------------------------------------------------------------------------------
 * Transport
 * ---------------------------------------------------------------------------------------------- */

async function getJson(path: string, accessToken: string, fetchImpl: FetchImpl): Promise<Json> {
  const response = await fetchImpl(`${PELOTON_API_BASE}${path}`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'peloton-platform': 'web',
      accept: 'application/json',
    },
  });
  if (response.status < 200 || response.status >= 300) {
    await response.text().catch(() => undefined);
    throw new ApiError(response.status, path.split('?')[0] ?? path);
  }
  const body: unknown = await response.json();
  return obj(body);
}

/* ------------------------------------------------------------------------------------------------
 * Field helpers: tolerate missing or oddly typed fields without throwing.
 * ---------------------------------------------------------------------------------------------- */

function obj(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** An identifier: a string as is, a finite number as its decimal string, anything else empty. */
function idStr(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return str(value);
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Zones as Peloton returns them: objects with slug ("zone1" to "zone5"), min_value, max_value.
 * The zone number comes from the slug, falling back to the position in the array.
 */
function parseZones(value: unknown): HeartRateZone[] {
  return arr(value).map((entry, index) => {
    const record = obj(entry);
    const slug = str(record.slug);
    const fromSlug = /(\d)/.exec(slug);
    return {
      zone: fromSlug ? Number(fromSlug[1]) : index + 1,
      slug,
      minValue: num(record.min_value) ?? 0,
      maxValue: num(record.max_value) ?? 0,
    };
  });
}
