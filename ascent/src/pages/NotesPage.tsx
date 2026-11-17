import { NotebookPen, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Markdown } from '../components/Markdown';
import { isTicked } from '../lib/game';
import type { NoteBlock } from '../lib/parser';
import { useGame } from '../lib/store';

/** Every 🧠 box opened so far: the DSA reference built up by climbing. */
export function NotesPage() {
  const progress = useGame((state) => state.progress);
  const quests = useGame((state) => state.quests);
  const [query, setQuery] = useState('');

  const all = useMemo(
    () =>
      [...quests.values()].flatMap((quest) =>
        quest.steps.flatMap((step) =>
          step.tasks
            .filter((task): task is NoteBlock => task.kind === 'note')
            .map((note) => ({ quest, step, note })),
        ),
      ),
    [quests],
  );
  const opened = all.filter(({ quest, step, note }) => isTicked(progress, quest.id, step.id, note.key));
  const q = query.trim().toLowerCase();
  const shown = q
    ? opened.filter(({ note, quest }) => `${note.title} ${note.md} ${quest.id}`.toLowerCase().includes(q))
    : opened;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-display text-4xl font-semibold">Field notes</h1>
      <p className="mt-1 text-mist">
        {opened.length} collected, {all.length - opened.length} still up on the mountain.
      </p>

      {opened.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-line p-8 text-center">
          <NotebookPen className="mx-auto size-8 text-faint" aria-hidden />
          <p className="mt-3 text-mist">
            Each 🧠 box you open on the climb lands here, searchable, as your own DSA reference.
          </p>
        </div>
      ) : (
        <>
          <label className="mt-5 flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2">
            <Search className="size-4 text-mist" aria-hidden />
            <span className="sr-only">Search your notes</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search: redis, O(log n), keyset…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
            />
          </label>
          <div className="mt-5 space-y-4">
            {shown.map(({ quest, step, note }) => (
              <article key={`${quest.id}${note.key}`} className="rounded-xl border border-line bg-panel p-5">
                <h2 className="font-display text-xl font-semibold">{note.title}</h2>
                <Link to={`/q/${quest.id}/${step.id}`} className="text-sm text-glacier hover:underline">
                  {quest.id} · Step {step.id}
                </Link>
                <div className="mt-3">
                  <Markdown md={note.md} basePath={quest.repoPath} />
                </div>
              </article>
            ))}
            {shown.length === 0 && <p className="text-center text-mist">No notes match that.</p>}
          </div>
        </>
      )}
    </main>
  );
}
