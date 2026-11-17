import { Check, ChevronDown, Flag, Lock, Tent } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { LinkFolder } from "../components/LinkFolder";
import { Markdown } from "../components/Markdown";
import {
  currentStep,
  partCleared,
  questPercent,
  stepState,
  summarizeSteps,
  type StepState,
} from "../lib/game";
import type { Part, Step } from "../lib/parser";
import { taskMetres } from "../lib/game";
import type { Quest } from "../lib/quests";
import { useGame } from "../lib/store";

type RouteNode =
  | { type: "base"; x: number; y: number }
  | { type: "camp"; x: number; y: number; part: Part }
  | { type: "step"; x: number; y: number; step: Step; elevation: number }
  | { type: "summit"; x: number; y: number };

const STEP_GAP = 76;
const CAMP_GAP = 118;

/** Lays the route out bottom-up, weaving left and right so it reads as a climb. */
function layout(quest: Quest) {
  const raw: Omit<RouteNode, "x" | "y">[] = [{ type: "base" }];
  let elevation = 0;
  for (const part of quest.parts) {
    for (const step of part.steps) {
      elevation += step.tasks.reduce((sum, task) => sum + taskMetres(task), 0);
      raw.push({ type: "step", step, elevation } as Omit<RouteNode, "x" | "y">);
    }
    raw.push({ type: "camp", part } as Omit<RouteNode, "x" | "y">);
  }
  raw.push({ type: "summit" });

  let y = 90;
  const placed = raw.map((node, i) => {
    if (i > 0) y += node.type === "step" ? STEP_GAP : CAMP_GAP;
    const x =
      node.type === "summit"
        ? 50
        : 50 + 20 * Math.sin(i * 0.86) + 4 * Math.sin(i * 0.31);
    return { ...node, x, y } as RouteNode;
  });
  const height = y + 150;
  return {
    height,
    nodes: placed.map((node) => ({ ...node, y: height - node.y }) as RouteNode),
  };
}

function smoothPath(points: { x: number; y: number }[]): string {
  const first = points[0];
  if (!first) return "";
  let d = `M${first.x} ${first.y}`;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as { x: number; y: number };
    const b = points[i] as { x: number; y: number };
    const midY = (a.y + b.y) / 2;
    d += ` C${a.x} ${midY} ${b.x} ${midY} ${b.x} ${b.y}`;
  }
  return d;
}

const STEP_DOT: Record<StepState, string> = {
  done: "bg-pine text-ink",
  skipped: "bg-panel-2 text-mist border border-line",
  current: "bg-glow text-ink anim-pulse size-11",
  locked: "bg-panel text-faint border border-line",
};

function StepNode({
  quest,
  node,
}: {
  quest: Quest;
  node: Extract<RouteNode, { type: "step" }>;
}) {
  const progress = useGame((state) => state.progress);
  const state = stepState(progress, quest, node.step.id);
  const onLeft = node.x > 50;
  return (
    <Link
      to={`/q/${quest.id}/${node.step.id}`}
      data-current={state === "current" || undefined}
      className="group absolute z-10 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${node.x}%`, top: node.y }}
      aria-label={`Step ${node.step.id}: ${node.step.title} (${state})`}
    >
      <span
        className={`flex size-9 items-center justify-center rounded-full font-mono text-[11px] font-semibold transition-transform group-hover:scale-110 ${STEP_DOT[state]}`}
      >
        {state === "done" ? (
          <Check className="size-4" strokeWidth={3} />
        ) : state === "locked" ? (
          <Lock className="size-3" />
        ) : (
          node.step.id
        )}
      </span>
      <span
        className={`absolute top-1/2 w-[min(40vw,20rem)] -translate-y-1/2 text-sm leading-tight ${
          onLeft ? "right-full mr-3 text-right" : "left-full ml-3"
        } ${state === "current" ? "font-semibold text-snow" : state === "locked" ? "text-faint group-hover:text-mist" : "text-mist group-hover:text-snow"}`}
      >
        {state === "current" ? (
          <span className="mb-0.5 block text-xs font-normal text-glow">
            You are here
          </span>
        ) : null}
        {(state === "done" || state === "locked") && (
          <span className="font-mono text-xs opacity-70">{node.step.id} </span>
        )}
        {node.step.title}
      </span>
    </Link>
  );
}

function CampNode({
  quest,
  node,
}: {
  quest: Quest;
  node: Extract<RouteNode, { type: "camp" }>;
}) {
  const progress = useGame((state) => state.progress);
  const cleared = partCleared(progress, quest, node.part.number);
  const summary = summarizeSteps(progress, quest, node.part.steps);
  return (
    <div
      className="absolute z-10 w-[min(18rem,62vw)] -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${Math.max(32, Math.min(68, node.x))}%`, top: node.y }}
    >
      <div
        className={`flex items-center gap-3 rounded-xl border p-3 ${
          cleared ? "border-glow/70 bg-panel-2" : "border-line bg-panel"
        }`}
      >
        <Tent
          className={`size-6 shrink-0 ${cleared ? "text-glow" : "text-faint"}`}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-[11px] tracking-widest text-mist uppercase">
            Camp {node.part.number}
          </p>
          <p className="truncate font-display font-semibold">
            {node.part.title}
          </p>
          {cleared && (
            <p className="font-mono text-xs text-glow">
              +{summary.earned.toLocaleString()} m
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function RoutePage() {
  const { questId = "" } = useParams();
  const quest = useGame((state) => state.quests.get(questId));
  const progress = useGame((state) => state.progress);
  const { nodes, height } = useMemo(
    () => (quest ? layout(quest) : { nodes: [], height: 0 }),
    [quest],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const [details, setDetails] = useState(false);

  useEffect(() => {
    const marker = scroller.current?.querySelector("[data-current]");
    marker?.scrollIntoView({ block: "center", behavior: "instant" });
  }, [questId]);

  if (!quest)
    return (
      <p className="p-10 text-center text-mist">
        This route isn't on the map yet.
      </p>
    );

  const next = currentStep(progress, quest);
  const reachedIndex = (() => {
    if (!next) return nodes.length - 1;
    return nodes.findIndex(
      (node) => node.type === "step" && node.step.id === next.id,
    );
  })();
  const points = nodes.map(({ x, y }) => ({ x, y }));
  const walked = points.slice(0, Math.max(1, reachedIndex + 1));
  const summary = summarizeSteps(progress, quest, quest.steps);

  return (
    <main>
      {/* Sticky, because the page opens at the climber's position, far below the top of the route. */}
      <div className="sticky top-14 z-20 border-b border-line bg-ink/95 backdrop-blur">
        <div className="mx-auto max-w-4xl px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <h1 className="font-display text-xl font-semibold">{quest.id}</h1>
            <dl className="flex gap-4 text-sm">
              {[
                ["climbed", `${questPercent(progress, quest)}%`],
                ["earned", `${summary.earned.toLocaleString()} m`],
                ["typed", `${summary.lines.toLocaleString()} lines`],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline gap-1.5">
                  <dd className="font-mono font-semibold tabular-nums">
                    {value}
                  </dd>
                  <dt className="hidden text-xs text-mist sm:block">{label}</dt>
                </div>
              ))}
            </dl>
            <button
              type="button"
              aria-expanded={details}
              onClick={() => setDetails(!details)}
              className="ml-auto flex items-center gap-1.5 rounded-md bg-panel-2 px-2.5 py-1 text-sm hover:bg-line"
            >
              Briefing & repo link
              <ChevronDown
                className={`size-4 transition-transform ${details ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>
          </div>
          {details && (
            <div className="anim-fade mt-3 max-h-[70vh] space-y-3 overflow-y-auto border-t border-line pt-3">
              <LinkFolder quest={quest} />
              <div className="border-t border-line pt-3">
                <Markdown md={quest.briefing} basePath={quest.repoPath} />
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        ref={scroller}
        className="route-sky relative overflow-hidden"
        style={{ height }}
      >
        <div className="relative mx-auto h-full max-w-4xl">
          {/* Inside this column, so the line and the nodes share one coordinate system. */}
          <svg
            className="absolute inset-0 size-full"
            viewBox={`0 0 100 ${height}`}
            preserveAspectRatio="none"
            aria-hidden
          >
            <path
              d={smoothPath(points)}
              fill="none"
              stroke="#3a4b5c"
              strokeWidth="3"
              strokeDasharray="2 9"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={smoothPath(walked)}
              fill="none"
              stroke="#ff7d4d"
              strokeWidth="4"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {nodes.map((node, i) => {
            if (node.type === "step")
              return <StepNode key={i} quest={quest} node={node} />;
            if (node.type === "camp")
              return <CampNode key={i} quest={quest} node={node} />;
            if (node.type === "summit") {
              return (
                <div
                  key={i}
                  className="absolute -translate-x-1/2 -translate-y-1/2 text-center"
                  style={{ left: `${node.x}%`, top: node.y }}
                >
                  <Flag
                    className={`mx-auto size-8 ${next ? "text-mist" : "text-gold"}`}
                    aria-hidden
                  />
                  <p className="mt-1 font-display text-xl font-semibold">
                    Summit
                  </p>
                </div>
              );
            }
            return (
              <div
                key={i}
                className="absolute -translate-x-1/2 -translate-y-1/2 text-center"
                style={{ left: `${node.x}%`, top: node.y }}
              >
                <p className="font-display text-lg font-semibold">Trailhead</p>
                <p className="text-xs text-mist">An empty folder</p>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
