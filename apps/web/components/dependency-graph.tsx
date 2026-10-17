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
import { type ReactNode, useMemo } from 'react';
import {
  CARD,
  type GraphTask,
  layoutGraph,
  type Point,
} from '@/components/graph-layout';

type Card = Node<{ card: ReactNode }, 'card'>;
type Arrow = Edge<{ path: string; waiting: boolean }, 'arrow'>;

// Arrow colours: grey once the prerequisite is done, orange (--warning-strong) while it waits.
export const ARROW = { done: '#8a8a8a', waiting: '#904a00' };
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
  return (
    <BaseEdge
      path={data!.path}
      markerEnd={markerEnd}
      style={{
        stroke: data!.waiting ? ARROW.waiting : ARROW.done,
        strokeWidth: 2,
        strokeDasharray: data!.waiting ? '6 6' : undefined,
      }}
    />
  );
}

const NODE_TYPES = { card: CardNode };
const EDGE_TYPES = { arrow: ArrowEdge };

/**
 * What waits for what (FR-23), laid out by `layoutGraph`: each phase a band named by `label`,
 * each task the card `card` draws, and an arrow from each prerequisite, dashed orange while
 * `waiting` says the task still waits for it. Only to look at: nothing moves, pans or zooms,
 * and it is inert, so it scrolls with the page and screen readers skip it for the task list.
 */
export function DependencyGraph<T extends GraphTask>({
  tasks,
  label,
  card,
  waiting,
}: {
  tasks: T[];
  label: (phase: number) => string;
  card: (task: T) => ReactNode;
  waiting: (from: T, to: T) => boolean;
}) {
  const { layout, nodes, edges } = useMemo(() => {
    const layout = layoutGraph(tasks);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const nodes: Card[] = tasks
      .map((task) => {
        const [x, y] = layout.cards.get(task.id)!;
        return {
          id: task.id,
          type: 'card' as const,
          position: { x, y },
          width: CARD.width,
          height: CARD.height,
          data: { card: card(task) },
        };
      })
      // Reading order: column by column, top to bottom.
      .sort(
        (a, b) => a.position.x - b.position.x || a.position.y - b.position.y,
      );
    const edges: Arrow[] = layout.arrows.map(({ from, to, points }) => {
      const still = waiting(byId.get(from)!, byId.get(to)!);
      return {
        id: `${from}-${to}`,
        source: from,
        target: to,
        type: 'arrow' as const,
        data: { path: pathThrough(points), waiting: still },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: still ? ARROW.waiting : ARROW.done,
          width: 14,
          height: 14,
        },
      };
    });
    return { layout, nodes, edges };
  }, [tasks, card, waiting]);

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
