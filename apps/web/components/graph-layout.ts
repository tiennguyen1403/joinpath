import dagre, { type GraphLabel } from '@dagrejs/dagre';

/** One task of the graph: what it waits for, and its phase's place in the template. */
export type GraphTask = { id: string; dependsOn: string[]; phase: number };

export type Point = [x: number, y: number];

/** Where each card, phase band and arrow goes, in px from the graph's top left corner. */
export type GraphLayout = {
  width: number;
  height: number;
  cards: Map<string, Point>;
  bands: { phase: number; x: number; width: number }[];
  // From the prerequisite's right edge to the left edge of the task that waits for it.
  arrows: { from: string; to: string; points: Point[] }[];
};

export const CARD = { width: 168, height: 112 };
const GAP = { x: 52, y: 32 };
// A band reaches this far around its cards; its name sits above them.
const PAD = 16;
const TOP = 56;
// Arrows on one side of a card, and lines in one gap, this far apart.
const PORT = 16;
const LANE = 8;

type Path = { from: GraphTask; to: GraphTask; ys: number[]; back: boolean };

/**
 * Lays the tasks out left to right, each phase a band of columns as the canvas draws them
 * (PLAN §10): a task sits one column right of the furthest prerequisite in its own phase.
 * dagre orders the cards in each column and finds the arrows a way between them; an arrow
 * back to an earlier phase runs below the cards. `tasks` come in template order. A draft's
 * may wait for each other in a loop (BR-T05 stops one only at publish): the link that
 * closes it runs back below the cards too.
 */
export function layoutGraph(
  tasks: GraphTask[],
  size: { width: number; height: number } = CARD,
): GraphLayout {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (task: GraphTask): number => {
    let d = depth.get(task.id);
    if (d === undefined) {
      d = 0;
      visiting.add(task.id);
      for (const id of task.dependsOn) {
        const prerequisite = byId.get(id);
        // A prerequisite still being placed waits for this task: a loop, so this link runs back.
        if (prerequisite?.phase === task.phase && !visiting.has(id)) {
          d = Math.max(d, depthOf(prerequisite) + 1);
        }
      }
      visiting.delete(task.id);
      depth.set(task.id, d);
    }
    return d;
  };
  const phases = [...new Set(tasks.map(({ phase }) => phase))].sort(
    (a, b) => a - b,
  );
  // Each phase's first column, after the columns of the phases before it.
  const first = new Map<number, number>();
  let columns = 0;
  for (const phase of phases) {
    first.set(phase, columns);
    const own = tasks.filter((task) => task.phase === phase);
    columns += Math.max(...own.map(depthOf)) + 1;
  }
  const column = (task: GraphTask) => first.get(task.phase)! + depthOf(task);
  const links = tasks.flatMap((to) =>
    to.dependsOn.flatMap((id) => {
      const from = byId.get(id);
      return from && from !== to ? [{ from, to }] : [];
    }),
  );
  // An arrow back runs down the gap after its prerequisite's column and up the gap before
  // its task's: room for those past the first and last columns.
  const back = links.filter(({ from, to }) => column(from) > column(to));
  const margin = GAP.x - PAD;
  const inset = back.some(({ to }) => column(to) === 0) ? margin : 0;
  const outset = back.some(({ from }) => column(from) === columns - 1)
    ? margin
    : 0;
  const left = (c: number) => PAD + inset + c * (size.width + GAP.x);

  // dagre leaves a rank between two for edge labels, so a column is every second rank; with
  // the ranks given, it skips ranking ("none" is missing from its types).
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'LR',
    ranker: 'none' as string as GraphLabel['ranker'],
    nodesep: GAP.y,
    ranksep: GAP.x,
    edgesep: 2 * LANE,
  });
  g.setDefaultEdgeLabel(() => ({}));
  for (const task of tasks) {
    g.setNode(task.id, {
      width: size.width,
      height: size.height,
      rank: 2 * column(task),
    });
  }
  for (const { from, to } of links) {
    if (column(from) < column(to)) g.setEdge(from.id, to.id);
  }
  dagre.layout(g);

  const shift =
    TOP + size.height / 2 - Math.min(...tasks.map(({ id }) => g.node(id).y));
  const cards = new Map<string, Point>(
    tasks.map((task) => [
      task.id,
      [left(column(task)), g.node(task.id).y - size.height / 2 + shift],
    ]),
  );
  const middle = (task: GraphTask) => cards.get(task.id)![1] + size.height / 2;
  const bottom =
    Math.max(...[...cards.values()].map(([, y]) => y)) + size.height;

  // An arrow's height at each column it crosses: where dagre put its dummy node there.
  const paths: Path[] = links.map(({ from, to }) => {
    const [a, b] = [column(from), column(to)];
    const ys = [middle(from)];
    if (a < b) {
      const { points = [] } = g.edge(from.id, to.id);
      for (let c = a + 1; c < b; c++) ys.push(points[2 * (c - a)].y + shift);
    }
    ys.push(middle(to));
    return { from, to, ys, back: a > b };
  });

  // Arrows on one side of a card leave or arrive apart, ordered by where they go or come
  // from, so they don't cross there. Arrows back run lowest.
  const spread = (end: 'from' | 'to') => {
    const toward = ({ ys, back }: Path) =>
      back ? Infinity : end === 'from' ? ys[1] : ys[ys.length - 2];
    for (const task of tasks) {
      const own = paths
        .filter((path) => path[end] === task)
        .sort((p, q) => toward(p) - toward(q));
      const step = Math.min(PORT, (size.height - 32) / (own.length - 1 || 1));
      own.forEach(({ ys }, i) => {
        ys[end === 'from' ? 0 : ys.length - 1] =
          middle(task) + (i - (own.length - 1) / 2) * step;
      });
    }
  };
  spread('from');
  spread('to');

  // A vertical run takes the middle of its gap, or steps aside from one it would overlap.
  const runs = new Map<number, { lo: number; hi: number; lane: number }[]>();
  const runIn = (c: number, y1: number, y2: number) => {
    const middleOfGap = left(c) + size.width + GAP.x / 2;
    if (y1 === y2) return middleOfGap;
    const [lo, hi] = [Math.min(y1, y2), Math.max(y1, y2)];
    const taken = runs.get(c) ?? [];
    runs.set(c, taken);
    const clash = (lane: number) =>
      taken.some(
        (run) =>
          run.lane === lane && run.lo <= hi + LANE && lo <= run.hi + LANE,
      );
    let lane = 0;
    for (let i = 1; clash(lane); i++) lane = i % 2 ? (i + 1) / 2 : -i / 2;
    taken.push({ lo, hi, lane });
    return middleOfGap + lane * LANE;
  };

  let channel = bottom + LANE;
  const arrows = paths.map(({ from, to, ys, back }) => {
    const a = column(from);
    const end: Point = [left(column(to)), ys[ys.length - 1]];
    const points: Point[] = [[left(a) + size.width, ys[0]]];
    if (back) {
      // Into the gap after it, down below every card, along to the gap before the task.
      channel += LANE;
      const out = runIn(a, ys[0], channel);
      const into = runIn(column(to) - 1, channel, end[1]);
      points.push(
        [out, ys[0]],
        [out, channel],
        [into, channel],
        [into, end[1]],
      );
    } else {
      for (let i = 1; i < ys.length; i++) {
        const x = runIn(a + i - 1, ys[i - 1], ys[i]);
        points.push([x, ys[i - 1]], [x, ys[i]]);
      }
    }
    points.push(end);
    return { from: from.id, to: to.id, points: corners(points) };
  });

  const bands = phases.map((phase) => {
    const own = tasks.filter((task) => task.phase === phase).map(column);
    const x = left(Math.min(...own)) - PAD;
    return { phase, x, width: left(Math.max(...own)) + size.width + PAD - x };
  });
  return {
    width: left(columns - 1) + size.width + PAD + outset,
    height: Math.max(bottom + 24, channel + PAD),
    cards,
    bands,
    arrows,
  };
}

/** The points where a path turns: repeats and points along a straight run go. */
function corners(points: Point[]) {
  const kept: Point[] = [];
  for (const p of points) {
    const [q, r] = [kept.at(-2), kept.at(-1)];
    if (r && r[0] === p[0] && r[1] === p[1]) continue;
    const straight =
      q &&
      r &&
      ((q[0] === r[0] && r[0] === p[0]) || (q[1] === r[1] && r[1] === p[1]));
    if (straight) kept[kept.length - 1] = p;
    else kept.push(p);
  }
  return kept;
}
