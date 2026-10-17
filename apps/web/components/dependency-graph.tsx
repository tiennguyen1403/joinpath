'use client';

import '@xyflow/react/dist/base.css';
import {
  BaseEdge,
  type Edge,
  type EdgeProps,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from '@xyflow/react';
import { type HTMLAttributes, type ReactNode, useMemo } from 'react';
import {
  CARD,
  type GraphTask,
  layoutGraph,
  type Point,
} from '@/components/graph-layout';

export type ArrowTone = 'plain' | 'waiting' | 'problem';
type Card = Node<{ card: ReactNode }, 'card'>;
type Arrow = Edge<{ path: string; tone: ArrowTone }, 'arrow'>;

// Arrows are grey; orange (--warning-strong) and dashed while a task still waits for them, red
// (--danger-strong) for a link a draft has to fix.
const ARROW: Record<ArrowTone, { color: string; dash?: string }> = {
  plain: { color: '#8a8a8a' },
  waiting: { color: '#904a00', dash: '6 6' },
  problem: { color: '#a5292b' },
};
// Room under the bands for React Flow's attribution.
const ATTRIBUTION = 20;

// React Flow draws an edge between handles, so each card has one on either side, unseen.
function CardNode({ data }: NodeProps<Card>) {
  return (
    <>
      <Handle type="target" position={Position.Left} className="invisible" />
      {data.card}
      <Handle type="source" position={Position.Right} className="invisible" />
    </>
  );
}

function ArrowEdge({ data, markerEnd }: EdgeProps<Arrow>) {
  const { color, dash } = ARROW[data!.tone];
  return (
    <BaseEdge
      path={data!.path}
      markerEnd={markerEnd}
      style={{ stroke: color, strokeWidth: 2, strokeDasharray: dash }}
    />
  );
}

const NODE_TYPES = { card: CardNode };
const EDGE_TYPES = { arrow: ArrowEdge };

/** An arrow's line as a legend shows it. */
export function ArrowLine({ tone }: { tone: ArrowTone }) {
  const { color, dash } = ARROW[tone];
  return (
    <svg width="22" height="8" viewBox="0 0 22 8" className="shrink-0">
      <path
        d="M 1 4 L 21 4"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={dash}
      />
    </svg>
  );
}

/**
 * The graph's card, as its tab panel (`panel`): what the graph is, the graph, scrolling
 * sideways when wider than the page, then `legend`. The `list` tab has the same tasks for
 * screen readers.
 */
export function GraphSection({
  panel,
  list,
  legend,
  children,
}: {
  panel: HTMLAttributes<HTMLElement>;
  list: string;
  legend: ReactNode;
  children: ReactNode;
}) {
  return (
    <section {...panel} className="rounded-2xl border border-border p-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 pt-2.5 pb-3.5">
        <h2 className="text-[15px] leading-[21px] font-semibold">
          What waits for what
        </h2>
        <p className="text-[13px] text-muted-foreground">
          Arrows point from a prerequisite to the task that waits for it
        </p>
      </div>
      <div className="overflow-x-auto pb-1">
        <p className="sr-only">
          The {list} tab lists the same tasks and what each waits for.
        </p>
        {children}
      </div>
      <ul
        aria-hidden
        className="flex flex-wrap gap-x-5 gap-y-2.5 px-3 pt-1.5 pb-1.5 text-[13px] leading-5 text-muted-foreground"
      >
        {legend}
      </ul>
    </section>
  );
}

/**
 * What waits for what (FR-23), laid out by `layoutGraph` with cards of `size`: each phase a
 * band named by `label`, each task the card `card` draws, and an arrow from each prerequisite
 * as `arrow` says, red ones drawn last. Only to look at: nothing moves, pans or zooms, and it
 * is inert, so it scrolls with the page and screen readers skip it for the task list.
 */
export function DependencyGraph<T extends GraphTask>({
  tasks,
  label,
  card,
  arrow,
  size = CARD,
}: {
  tasks: T[];
  label: (phase: number) => string;
  card: (task: T) => ReactNode;
  arrow: (from: T, to: T) => ArrowTone;
  size?: { width: number; height: number };
}) {
  const { layout, nodes, edges } = useMemo(() => {
    const layout = layoutGraph(tasks, size);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const nodes: Card[] = tasks
      .map((task) => {
        const [x, y] = layout.cards.get(task.id)!;
        return {
          id: task.id,
          type: 'card' as const,
          position: { x, y },
          width: size.width,
          height: size.height,
          data: { card: card(task) },
        };
      })
      // Reading order: column by column, top to bottom.
      .sort(
        (a, b) => a.position.x - b.position.x || a.position.y - b.position.y,
      );
    const edges: Arrow[] = layout.arrows
      .map(({ from, to, points }) => {
        const tone = arrow(byId.get(from)!, byId.get(to)!);
        return {
          // Keys may hold "-", never ">".
          id: `${from}>${to}`,
          source: from,
          target: to,
          type: 'arrow' as const,
          data: { path: pathThrough(points), tone },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: ARROW[tone].color,
            width: 14,
            height: 14,
          },
        };
      })
      .sort(
        (a, b) =>
          Number(a.data.tone === 'problem') - Number(b.data.tone === 'problem'),
      );
    return { layout, nodes, edges };
  }, [tasks, card, arrow, size]);

  return (
    <div
      inert
      className="relative"
      style={{ width: layout.width, height: layout.height + ATTRIBUTION }}
    >
      {layout.bands.map((band) => (
        <div
          key={band.phase}
          className="absolute top-0 rounded-2xl bg-card"
          style={{ left: band.x, width: band.width, height: layout.height }}
        >
          <span className="absolute top-4.5 left-4 max-w-42 truncate text-xs leading-4 font-medium text-muted-foreground">
            {label(band.phase)}
          </span>
        </div>
      ))}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        width={layout.width}
        height={layout.height + ATTRIBUTION}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        minZoom={1}
        maxZoom={1}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        panOnDrag={false}
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        disableKeyboardA11y
      />
    </div>
  );
}

/** An arrow's path through its corners, each rounded, ending 1 px short of the card. */
function pathThrough(points: Point[]) {
  const last = points.length - 1;
  const at = (i: number): Point =>
    i === last ? [points[i][0] - 1, points[i][1]] : points[i];
  let d = `M ${at(0)[0]} ${at(0)[1]}`;
  for (let i = 1; i < last; i++) {
    const [[px, py], [x, y], [nx, ny]] = [at(i - 1), at(i), at(i + 1)];
    const r = Math.min(
      8,
      Math.hypot(x - px, y - py) / 2,
      Math.hypot(nx - x, ny - y) / 2,
    );
    const [ix, iy] = [Math.sign(x - px), Math.sign(y - py)];
    const [ox, oy] = [Math.sign(nx - x), Math.sign(ny - y)];
    d += ` L ${x - ix * r} ${y - iy * r} Q ${x} ${y} ${x + ox * r} ${y + oy * r}`;
  }
  return `${d} L ${at(last)[0]} ${at(last)[1]}`;
}
