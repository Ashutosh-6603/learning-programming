import { BadgeCheck, FolderGit2, Unlink } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { setLink, VERIFIED_BONUS } from '../lib/game';
import type { Quest } from '../lib/quests';
import { useGame } from '../lib/store';

export function LinkFolder({ quest }: { quest: Quest }) {
  const progress = useGame((state) => state.progress);
  const set = useGame((state) => state.set);
  const linked = progress.links[quest.id];
  const [value, setValue] = useState(linked ?? '');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const path = value.trim();
    if (!path) return;
    setChecking(true);
    const response = await fetch(`/api/git-log?path=${encodeURIComponent(path)}`);
    const result = (await response.json()) as { ok: boolean; error?: string };
    setChecking(false);
    if (!result.ok) return setError(result.error ?? 'Could not read that folder');
    setError(null);
    set(setLink(progress, quest.id, path));
  };

  if (linked) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <BadgeCheck className="size-4 text-pine" aria-hidden />
        <span className="text-mist">Watching commits in</span>
        <code className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-xs break-all">{linked}</code>
        <button
          type="button"
          onClick={() => set(setLink(progress, quest.id, null))}
          className="flex items-center gap-1 text-faint hover:text-snow"
        >
          <Unlink className="size-3.5" /> unlink
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <label htmlFor={`link-${quest.id}`} className="flex items-center gap-2 text-sm text-snow">
        <FolderGit2 className="size-4 text-glacier" aria-hidden />
        Link your rebuild folder for verified commits (+{VERIFIED_BONUS} m each)
      </label>
      <div className="mt-2 flex gap-2">
        <input
          id={`link-${quest.id}`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="~/rebuilds/taskflow-express"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-line bg-ink px-3 py-1.5 font-mono text-sm placeholder:text-faint"
        />
        <button
          type="submit"
          disabled={checking}
          className="rounded-md bg-panel-2 px-3 py-1.5 text-sm font-medium hover:bg-line"
        >
          Link
        </button>
      </div>
      {error && <p className="mt-1.5 text-sm text-rose">{error}</p>}
    </form>
  );
}
