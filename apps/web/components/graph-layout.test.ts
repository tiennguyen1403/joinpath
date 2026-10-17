import { describe, expect, it } from 'vitest';
import { CARD, type GraphTask, layoutGraph, type Point } from './graph-layout';

// Engineering Onboarding v1, as Bao's onboarding in the demo has it: what waits for what,
// in three phases.
const engineering: GraphTask[] = [
  { id: 'upload-id', dependsOn: [], phase: 0 },
  { id: 'review-id', dependsOn: ['upload-id'], phase: 0 },
  { id: 'sign-handbook', dependsOn: [], phase: 0 },
  { id: 'prepare-laptop', dependsOn: [], phase: 0 },
  { id: 'create-accounts', dependsOn: ['review-id'], phase: 0 },
  { id: 'assign-buddy', dependsOn: [], phase: 0 },
  { id: 'welcome-meeting', dependsOn: [], phase: 1 },
  {
    id: 'set-up-dev-env',
    dependsOn: ['prepare-laptop', 'create-accounts'],
    phase: 1,
  },
  { id: 'ship-first-pr', dependsOn: ['set-up-dev-env'], phase: 2 },
  { id: 'week-one-check-in', dependsOn: ['welcome-meeting'], phase: 2 },
];

/** Whether a horizontal or vertical run passes through the inside of a card. */
const crosses = ([x1, y1]: Point, [x2, y2]: Point, [left, top]: Point) =>
  Math.max(x1, x2) > left &&
  Math.min(x1, x2) < left + CARD.width &&
  Math.max(y1, y2) > top &&
  Math.min(y1, y2) < top + CARD.height;

describe('layoutGraph', () => {
  it('FR-23: gives each phase its own band of columns, a task right of what it waits for', () => {
    const { cards, bands } = layoutGraph(engineering);
    const x = (id: string) => cards.get(id)![0];

    expect(x('review-id')).toBeGreaterThan(x('upload-id'));
    expect(x('create-accounts')).toBeGreaterThan(x('review-id'));
    // Nothing in its own phase to wait for: the phase's first column.
    for (const id of ['sign-handbook', 'prepare-laptop', 'assign-buddy']) {
      expect(x(id)).toBe(x('upload-id'));
    }
    expect(x('set-up-dev-env')).toBe(x('welcome-meeting'));
    expect(bands.map(({ phase }) => phase)).toEqual([0, 1, 2]);
    bands.slice(1).forEach((band, i) => {
      expect(band.x).toBeGreaterThan(bands[i].x + bands[i].width);
    });
    for (const { id, phase } of engineering) {
      const band = bands.find((each) => each.phase === phase)!;
      expect(x(id)).toBeGreaterThan(band.x);
      expect(x(id) + CARD.width).toBeLessThan(band.x + band.width);
    }
  });

  it('FR-23: draws an arrow for each wait, from edge to edge, never across a card', () => {
    const { cards, arrows } = layoutGraph(engineering);

    expect(arrows.map(({ from, to }) => `${from} > ${to}`).sort()).toEqual(
      engineering
        .flatMap(({ id, dependsOn }) =>
          dependsOn.map((from) => `${from} > ${id}`),
        )
        .sort(),
    );
    for (const { from, to, points } of arrows) {
      const [start, end] = [points[0], points.at(-1)!];
      expect(start[0]).toBe(cards.get(from)![0] + CARD.width);
      expect(end[0]).toBe(cards.get(to)![0]);
      points.slice(1).forEach((point, i) => {
        const [x, y] = points[i];
        expect(point[0] === x || point[1] === y).toBe(true);
        for (const card of cards.values()) {
          expect(crosses(points[i], point, card)).toBe(false);
        }
      });
    }
    // Two arrows into Set up dev environment arrive apart.
    const into = arrows
      .filter(({ to }) => to === 'set-up-dev-env')
      .map(({ points }) => points.at(-1)![1]);
    expect(new Set(into).size).toBe(2);
  });

  it('FR-23: runs an arrow back to an earlier phase below every card', () => {
    const { cards, arrows, width } = layoutGraph([
      { id: 'welcome-kit', dependsOn: ['t-shirt'], phase: 0 },
      { id: 'prepare-laptop', dependsOn: [], phase: 0 },
      { id: 't-shirt', dependsOn: [], phase: 1 },
      { id: 'welcome-meeting', dependsOn: ['prepare-laptop'], phase: 1 },
    ]);
    const back = arrows.find(({ to }) => to === 'welcome-kit')!;
    const bottom = Math.max(
      ...[...cards.values()].map(([, y]) => y + CARD.height),
    );

    expect(Math.max(...back.points.map(([, y]) => y))).toBeGreaterThan(bottom);
    expect(back.points.at(-1)![0]).toBe(cards.get('welcome-kit')![0]);
    back.points.slice(1).forEach((point, i) => {
      for (const card of cards.values()) {
        expect(crosses(back.points[i], point, card)).toBe(false);
      }
    });
    // Room on both sides for the runs down and back up.
    expect(Math.min(...back.points.map(([x]) => x))).toBeGreaterThan(0);
    expect(Math.max(...back.points.map(([x]) => x))).toBeLessThan(width);
  });
});
