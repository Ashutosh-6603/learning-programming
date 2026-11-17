import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Check,
  FastForward,
  GitCommitHorizontal,
  NotebookPen,
  RotateCcw,
  SquareTerminal,
  Type,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useNavigate, useParams } from "react-router";
import { LinkFolder } from "../components/LinkFolder";
import { CodeView, InlineCode, Markdown } from "../components/Markdown";
import {
  currentStep,
  isTicked,
  reopenStep,
  skipTo,
  stepState,
  stepTicks,
  taskMetres,
  toggleTask,
  VERIFIED_BONUS,
  verifyCommit,
  type StepState,
} from "../lib/game";
import type { CommitBlock, Step, TaskBlock } from "../lib/parser";
import { findStep, type Quest } from "../lib/quests";
import { useGame } from "../lib/store";

const VERB: Record<string, string> = {
  type: "I typed it",
  run: "I ran it",
  read: "Understood",
  note: "Open the field note",
  check: "Checkpoint passed",
  commit: "Committed",
};

function verbFor(block: TaskBlock) {
  return VERB[block.kind === "code" ? block.task : block.kind] as string;
}

function titleFor(block: TaskBlock): ReactNode {
  switch (block.kind) {
    case "code":
      return block.task === "run" ? (
        "Run this"
      ) : block.path ? (
        <span className="font-mono text-[0.92em]">{block.path}</span>
      ) : (
        "Type this"
      );
    case "read":
      return block.title;
    case "note":
      return "Field note";
    case "check":
      return "Checkpoint";
    case "commit":
      return "Commit";
  }
}

function plainTitle(block: TaskBlock): string {
  switch (block.kind) {
    case "code":
      return block.task === "run"
        ? `Run: ${block.code.split("\n")[0]?.slice(0, 48)}`
        : (block.path ?? "Type this block");
    case "read":
      return block.title;
    case "note":
      return `Field note: ${block.title}`;
    case "check":
      return "Prove it works";
    case "commit":
      return block.message;
  }
}

function iconFor(block: TaskBlock) {
  const props = { className: "size-4", "aria-hidden": true };
  switch (block.kind) {
    case "code":
      return block.task === "run" ? (
        <SquareTerminal {...props} />
      ) : (
        <Type {...props} />
      );
    case "read":
      return <BookOpen {...props} />;
    case "note":
      return <NotebookPen {...props} />;
    case "check":
      return <Check {...props} />;
    case "commit":
      return <GitCommitHorizontal {...props} />;
  }
}

/** The big satisfying box. Sticky, so it's within reach however long the block is. */
function TickButton({
  done,
  disabled,
  label,
  verified,
  onToggle,
}: {
  done: boolean;
  disabled: boolean;
  label: string;
  verified: boolean;
  onToggle: () => void;
}) {
  // Set while rendering (not in an effect) so the animation starts on the same frame as the tick.
  const [previous, setPrevious] = useState(done);
  const [justDone, setJustDone] = useState(false);
  if (previous !== done) {
    setPrevious(done);
    setJustDone(done);
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        onToggle();
        event.currentTarget.blur();
      }}
      className={`relative flex size-8 items-center justify-center rounded-full border-2 transition-colors ${
        done
          ? verified
            ? "border-pine bg-pine text-ink"
            : "border-glow bg-glow text-ink"
          : disabled
            ? "border-line bg-ink"
            : "border-mist bg-ink hover:border-glow"
      } ${justDone ? "anim-tick" : ""}`}
    >
      {justDone && (
        <span className="anim-ring absolute inset-0 rounded-full border-2 border-glow" />
      )}
      {done && (
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path
            d="m5 12.5 4.6 4.6L19 7.5"
            className={justDone ? "anim-check" : ""}
          />
        </svg>
      )}
    </button>
  );
}

function CommitBody({
  quest,
  block,
  verified,
  linked,
  watching,
}: {
  quest: Quest;
  block: CommitBlock;
  verified: boolean;
  linked: boolean;
  watching: boolean;
}) {
  return (
    <div className="space-y-3 p-4">
      <p className="font-mono text-sm text-snow">{block.message}</p>
      <CodeView code={block.command} lang="bash" />
      {verified ? (
        <p className="flex items-center gap-2 text-sm text-pine">
          <BadgeCheck className="size-4" aria-hidden /> Found in your repo.
          Verified.
        </p>
      ) : linked ? (
        <p className="flex items-center gap-2 text-sm text-mist">
          {watching && (
            <span
              className="size-2 animate-pulse rounded-full bg-pine"
              aria-hidden
            />
          )}
          Watching your repo. Commit and this ticks itself (+{VERIFIED_BONUS}{" "}
          m).
        </p>
      ) : (
        <div className="border-t border-line pt-3">
          <LinkFolder quest={quest} />
        </div>
      )}
    </div>
  );
}

function TaskCard({
  quest,
  step,
  block,
  isNext,
  locked,
  basePath,
  onToggle,
  watching,
  floater,
}: {
  quest: Quest;
  step: Step;
  block: TaskBlock;
  isNext: boolean;
  locked: boolean;
  basePath: string;
  onToggle: () => void;
  watching: boolean;
  floater: { id: number; m: number } | null;
}) {
  const progress = useGame((state) => state.progress);
  const tick = stepTicks(progress, quest.id, step.id)[block.key];
  const done = tick !== undefined;
  const verified = tick?.verified === true;
  const metres = taskMetres(block);
  const linked = Boolean(progress.links[quest.id]);
  const isClosedNote = block.kind === "note" && !done;

  return (
    <section data-task={block.key} className="relative pl-11 sm:pl-14">
      <span
        className={`absolute top-0 bottom-0 left-[15px] w-0.5 sm:left-[23px] ${done ? "bg-glow" : "bg-line"}`}
        aria-hidden
      />
      <div className="sticky top-20 z-10 float-left -ml-11 h-0 sm:-ml-14 sm:pl-2">
        <div className="relative">
          <TickButton
            done={done}
            disabled={locked || step.tasks.length === 0}
            verified={verified}
            label={`${verbFor(block)}: ${plainTitle(block)}`}
            onToggle={onToggle}
          />
          {floater && (
            <span
              key={floater.id}
              className={`anim-float pointer-events-none absolute top-0 left-9 font-mono text-sm font-bold whitespace-nowrap ${verified ? "text-pine" : "text-glow"}`}
            >
              +{floater.m} m
            </span>
          )}
        </div>
      </div>

      <div
        className={`mb-5 overflow-hidden rounded-xl border transition-all duration-300 ${
          isNext
            ? "border-glow/70 bg-panel shadow-[0_0_30px_-10px_rgb(255_125_77/0.55)]"
            : done
              ? "border-line/60 bg-panel/40 opacity-70 hover:opacity-100"
              : "border-line bg-panel"
        }`}
      >
        <div className="flex items-center gap-2 border-b border-line/70 px-4 py-2.5 text-sm">
          <span className={done ? "text-mist" : "text-glacier"}>
            {iconFor(block)}
          </span>
          <span className="min-w-0 truncate font-medium">
            {titleFor(block)}
          </span>
          {block.kind === "code" && block.action && (
            <span className="hidden truncate text-xs text-mist sm:inline">
              <InlineCode text={block.action} />
            </span>
          )}
          <span className="ml-auto shrink-0 font-mono text-xs text-mist tabular-nums">
            {block.kind === "code" &&
              block.task === "type" &&
              `${block.lines} lines · `}
            {done ? tick.m : metres} m
          </span>
        </div>

        {block.kind === "code" && (
          <CodeView code={block.code} lang={block.lang} />
        )}
        {block.kind === "read" && block.md && (
          <div className="p-4">
            <Markdown md={block.md} basePath={basePath} />
          </div>
        )}
        {block.kind === "check" && (
          <div className="p-4">
            <Markdown md={block.md} basePath={basePath} />
          </div>
        )}
        {block.kind === "commit" && (
          <CommitBody
            quest={quest}
            block={block}
            verified={verified}
            linked={linked}
            watching={watching}
          />
        )}
        {block.kind === "note" &&
          (isClosedNote ? (
            <div className="p-4">
              <p className="font-display text-lg font-semibold">
                {block.title}
              </p>
              <p className="mt-1 text-sm text-mist">
                Before you open it: what data structure would you reach for
                here, and what would it cost at a million rows?
              </p>
              {!locked && (
                <button
                  type="button"
                  onClick={onToggle}
                  className="mt-3 rounded-lg border border-gold/60 px-4 py-2 text-sm font-medium text-gold transition-colors hover:bg-gold/10"
                >
                  Open the field note · +{metres} m
                </button>
              )}
            </div>
          ) : (
            <div className="anim-note p-4">
              <p className="mb-2 font-display text-lg font-semibold">
                {block.title}
              </p>
              <Markdown md={block.md} basePath={basePath} />
            </div>
          ))}
      </div>
    </section>
  );
}

function useCommitWatcher(quest: Quest | undefined, step: Step | undefined) {
  const play = useGame((state) => state.play);
  const link = useGame((state) =>
    quest ? state.progress.links[quest.id] : undefined,
  );
  const commit = step?.tasks.find(
    (task): task is CommitBlock => task.kind === "commit",
  );
  const alreadyVerified = useGame((state) =>
    quest && step && commit
      ? stepTicks(state.progress, quest.id, step.id)[commit.key]?.verified ===
        true
      : false,
  );
  const isLocked = useGame((state) =>
    quest && step
      ? stepState(state.progress, quest, step.id) === "locked"
      : true,
  );
  const watching = Boolean(link && commit && !alreadyVerified && !isLocked);

  useEffect(() => {
    if (!watching || !quest || !step || !commit || !link) return;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const response = await fetch(
        `/api/git-log?path=${encodeURIComponent(link)}`,
      ).catch(() => null);
      if (!response?.ok || stopped) return;
      const result = (await response.json()) as {
        ok: boolean;
        subjects?: string[];
      };
      if (!result.subjects?.includes(commit.message)) return;
      const { progress, quests } = useGame.getState();
      play(
        verifyCommit(
          progress,
          quest,
          step,
          commit,
          [...quests.values()],
          new Date(),
        ),
      );
    };
    void check();
    const timer = setInterval(() => void check(), 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [watching, quest, step, commit, link, play]);

  return watching;
}

const STATE_LABEL: Partial<Record<StepState, string>> = {
  done: "Done",
  skipped: "Skipped",
};

export function StepPage() {
  const { questId = "", stepId = "" } = useParams();
  const quest = useGame((state) => state.quests.get(questId));
  const step = quest && findStep(quest, stepId);
  const progress = useGame((state) => state.progress);
  const play = useGame((state) => state.play);
  const set = useGame((state) => state.set);
  const celebration = useGame((state) => state.celebration);
  const lastEvent = useGame((state) => state.lastEvent);
  const navigate = useNavigate();
  const [floater, setFloater] = useState<{
    id: number;
    key: string;
    m: number;
  } | null>(null);
  const [skipOpen, setSkipOpen] = useState(false);
  const watching = useCommitWatcher(quest, step);
  const lastKey = useRef<string | null>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    lastKey.current = null;
  }, [questId, stepId]);

  useEffect(() => {
    if (!lastEvent) return;
    // A verified commit ticks itself, so no click says which task it belongs to.
    const commitKey = step?.tasks.find((task) => task.kind === "commit")?.key;
    const key = lastEvent.verified ? commitKey : lastKey.current;
    if (!key) return;
    const frame = requestAnimationFrame(() =>
      setFloater({ id: lastEvent.id, key, m: lastEvent.m }),
    );
    return () => cancelAnimationFrame(frame);
  }, [lastEvent, step]);

  const state = quest && step ? stepState(progress, quest, step.id) : "locked";
  const locked = state === "locked";
  const finished = state === "done" || state === "skipped";
  const tasks = step?.tasks ?? [];
  const nextTask =
    quest && step
      ? tasks.find((t) => !isTicked(progress, quest.id, step.id, t.key))
      : undefined;

  const toggle = useCallback(
    (block: TaskBlock) => {
      if (!quest || !step) return;
      const { progress: current, quests } = useGame.getState();
      lastKey.current = block.key;
      const wasTicked = isTicked(current, quest.id, step.id, block.key);
      play(
        toggleTask(
          current,
          quest,
          step,
          block,
          [...quests.values()],
          new Date(),
        ),
      );
      // A field note was just opened to be read: scrolling away now would undo the reveal.
      if (wasTicked || block.kind === "note") return;
      // Glide to the next thing to do, so the hands can stay on the keyboard.
      requestAnimationFrame(() => {
        const updated = useGame.getState().progress;
        const upcoming = step.tasks.find(
          (t) => !isTicked(updated, quest.id, step.id, t.key),
        );
        if (!upcoming) return;
        document
          .querySelector(`[data-task="${upcoming.key}"]`)
          ?.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    },
    [play, quest, step],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (celebration || !quest || !step) return;
      if (
        (event.target as HTMLElement).closest(
          "input, textarea, button, a, [contenteditable]",
        )
      )
        return;
      if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        if (nextTask && !locked && !finished) {
          // Never tick something off-screen: bring it into view first, so Enter can't skip reading.
          const card = document.querySelector(`[data-task="${nextTask.key}"]`);
          const rect = card?.getBoundingClientRect();
          const visible =
            rect && rect.bottom > 72 && rect.top < window.innerHeight - 90;
          if (visible) toggle(nextTask);
          else card?.scrollIntoView({ block: "start", behavior: "smooth" });
        } else if (finished) {
          const next = currentStep(progress, quest);
          void navigate(next ? `/q/${quest.id}/${next.id}` : `/q/${quest.id}`);
        }
      }
      if (event.key === "Escape") void navigate(`/q/${quest.id}`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    celebration,
    quest,
    step,
    nextTask,
    locked,
    finished,
    toggle,
    navigate,
    progress,
  ]);

  if (!quest || !step)
    return <p className="p-10 text-center text-mist">Off the route.</p>;

  const part = quest.parts.find(
    (candidate) => candidate.number === step.partNumber,
  );
  const doneCount = tasks.filter((t) =>
    isTicked(progress, quest.id, step.id, t.key),
  ).length;
  const index = quest.steps.indexOf(step);
  const previous = quest.steps[index - 1];
  const following = quest.steps[index + 1];
  const nextForDock = currentStep(progress, quest);
  const isFirstOfPart = part?.steps[0]?.id === step.id;

  return (
    <>
      <main className="mx-auto max-w-3xl px-4 pt-5 pb-36">
        <nav className="flex items-center justify-between text-sm text-mist">
          <Link
            to={`/q/${quest.id}`}
            className="flex items-center gap-1.5 hover:text-snow"
          >
            <ArrowLeft className="size-4" aria-hidden /> {quest.id}
          </Link>
          <span className="flex gap-3">
            {previous && (
              <Link
                to={`/q/${quest.id}/${previous.id}`}
                className="hover:text-snow"
              >
                ← {previous.id}
              </Link>
            )}
            {following && (
              <Link
                to={`/q/${quest.id}/${following.id}`}
                className="hover:text-snow"
              >
                {following.id} →
              </Link>
            )}
          </span>
        </nav>

        <header className="mt-5">
          <p className="text-sm text-rose">
            Camp {step.partNumber} · {part?.title}
            {STATE_LABEL[state] ? ` · ${STATE_LABEL[state]}` : ""}
          </p>
          <h1 className="mt-1 font-display text-3xl font-semibold text-balance sm:text-4xl">
            <span className="font-mono text-2xl text-mist sm:text-3xl">
              {step.id}
            </span>{" "}
            {step.title}
          </h1>
          {step.goal && (
            <div className="mt-3 text-mist">
              <Markdown md={step.goal} basePath={quest.repoPath} />
            </div>
          )}
          {step.files && (
            <div className="mt-2 text-sm text-mist [&_.prose-md]:text-sm">
              <Markdown
                md={`**Files:** ${step.files}`}
                basePath={quest.repoPath}
              />
            </div>
          )}
        </header>

        {locked && (
          <div className="mt-5 rounded-xl border border-line bg-panel-2 p-4">
            <p className="font-medium">
              You can read ahead, but this step is still locked.
            </p>
            <p className="mt-1 text-sm text-mist">
              {nextForDock && (
                <>
                  You're on{" "}
                  <Link
                    to={`/q/${quest.id}/${nextForDock.id}`}
                    className="text-glacier underline"
                  >
                    Step {nextForDock.id}
                  </Link>
                  .{" "}
                </>
              )}
              Already built the earlier steps? Skip to here. Skipped steps earn
              no metres, and their camps stay unstamped.
            </p>
            {skipOpen ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    set(skipTo(progress, quest, step.id, new Date()));
                    setSkipOpen(false);
                  }}
                  className="flex items-center gap-1.5 rounded-md bg-glow px-3 py-1.5 text-sm font-semibold text-ink"
                >
                  <FastForward className="size-4" aria-hidden /> Yes, skip to{" "}
                  {step.id}
                </button>
                <button
                  type="button"
                  onClick={() => setSkipOpen(false)}
                  className="rounded-md px-3 py-1.5 text-sm text-mist hover:text-snow"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSkipOpen(true)}
                className="mt-3 rounded-md bg-panel px-3 py-1.5 text-sm hover:bg-line"
              >
                Skip ahead to this step…
              </button>
            )}
          </div>
        )}

        {isFirstOfPart && part?.intro && (
          <div className="mt-5">
            <Markdown md={part.intro} basePath={quest.repoPath} />
          </div>
        )}

        <div className="mt-7">
          {step.blocks.map((block, i) => {
            if (block.kind === "prose") {
              return (
                <div key={i} className="mb-5 pl-11 sm:pl-14">
                  <Markdown md={block.md} basePath={quest.repoPath} />
                </div>
              );
            }
            return (
              <TaskCard
                key={block.key}
                quest={quest}
                step={step}
                block={block}
                isNext={!finished && !locked && nextTask?.key === block.key}
                locked={locked}
                basePath={quest.repoPath}
                onToggle={() => toggle(block)}
                watching={watching}
                floater={floater?.key === block.key ? floater : null}
              />
            );
          })}
        </div>

        {step.commitNote && (
          <p className="pl-11 text-sm text-mist sm:pl-14">
            <span className="font-medium">Commit:</span>{" "}
            <InlineCode text={step.commitNote} />
          </p>
        )}

        {state === "done" && (
          <button
            type="button"
            onClick={() => set(reopenStep(progress, quest.id, step.id))}
            className="mt-4 ml-11 flex items-center gap-1.5 text-sm text-faint hover:text-snow sm:ml-14"
          >
            <RotateCcw className="size-3.5" aria-hidden /> Reopen this step
          </button>
        )}
      </main>

      {!locked && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-ink/95 backdrop-blur">
          <div className="mx-auto max-w-3xl px-4 py-3">
            <div className="flex gap-1" aria-hidden>
              {tasks.map((task) => (
                <span
                  key={task.key}
                  className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                    isTicked(progress, quest.id, step.id, task.key)
                      ? "bg-glow"
                      : "bg-panel-2"
                  }`}
                />
              ))}
            </div>
            <div className="mt-2.5 flex items-center gap-3">
              <p className="min-w-0 flex-1 truncate text-sm">
                {finished ? (
                  <span className="text-pine">
                    {state === "done"
                      ? "This step is done."
                      : "You skipped this step."}
                  </span>
                ) : nextTask ? (
                  <>
                    <span className="font-mono text-xs text-mist tabular-nums">
                      {doneCount}/{tasks.length}
                    </span>{" "}
                    <span className="text-mist">Next:</span>{" "}
                    {plainTitle(nextTask)}
                  </>
                ) : null}
              </p>
              {finished ? (
                <Link
                  to={
                    nextForDock
                      ? `/q/${quest.id}/${nextForDock.id}`
                      : `/q/${quest.id}`
                  }
                  className="flex shrink-0 items-center gap-2 rounded-lg bg-glow px-4 py-2 text-sm font-semibold text-ink"
                >
                  {nextForDock ? `Go to ${nextForDock.id}` : "See the route"}{" "}
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              ) : (
                nextTask && (
                  <button
                    type="button"
                    onClick={(event) => {
                      toggle(nextTask);
                      event.currentTarget.blur();
                    }}
                    className="flex shrink-0 items-center gap-2 rounded-lg bg-glow px-4 py-2 text-sm font-semibold text-ink transition-transform hover:scale-[1.03] active:scale-95"
                  >
                    {verbFor(nextTask)}
                    <kbd className="hidden rounded bg-ink/15 px-1.5 text-xs font-medium sm:inline">
                      ↵
                    </kbd>
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
