/**
 * A fake clock and scheduler for the poller tests. now() returns fake epoch milliseconds; setTimer
 * and clearTimer replace setTimeout and clearTimeout. advance(ms) runs every timer due within the
 * window in time order, letting promise chains settle after each one, so nothing ever sleeps.
 */
import { setImmediate } from 'node:timers/promises';

export function createFakeClock(start = 1_789_000_000_000) {
  let current = start;
  let sequence = 0;
  const timers = new Map();

  const clock = {
    now: () => current,
    setTimer(fn, ms) {
      const handle = { id: ++sequence, at: current + Math.max(0, ms), fn };
      timers.set(handle.id, handle);
      return handle;
    },
    clearTimer(handle) {
      if (handle !== undefined && handle !== null) {
        timers.delete(handle.id);
      }
    },
    /** Awaited between timer firings; the poller tests point it at Poller.whenIdle. */
    idle: async () => undefined,
    /** Lets pending promise chains and in-flight work run without moving time. */
    async settle(rounds = 4) {
      for (let index = 0; index < rounds; index += 1) {
        await clock.idle();
        await setImmediate();
      }
    },
    /** Moves time forward, firing due timers in order and settling after each. */
    async advance(ms) {
      const target = current + ms;
      await clock.settle();
      for (;;) {
        const due = [...timers.values()].filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (due === undefined) {
          break;
        }
        timers.delete(due.id);
        current = Math.max(current, due.at);
        due.fn();
        await clock.settle();
      }
      current = target;
      await clock.settle();
    },
    /** Pending timers as { at, ms } relative to now, for asserting schedules. */
    pending() {
      return [...timers.values()].sort((a, b) => a.at - b.at || a.id - b.id).map((timer) => ({ at: timer.at, ms: timer.at - current }));
    },
  };
  return clock;
}
