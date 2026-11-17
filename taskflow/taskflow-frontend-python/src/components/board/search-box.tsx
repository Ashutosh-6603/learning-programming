import { Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { parseHeadline } from '@/lib/headline';
import { useSearch } from '@/lib/queries/search';

interface Props {
  workspaceId: string;
  value: string;
  onChange: (value: string) => void;
}

/**
 * Two searches in one box: typing dims non-matching cards on this board instantly (client-side),
 * and, debounced, asks the server's full-text search across the whole workspace.
 */
export function SearchBox({ workspaceId, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const q = useDebouncedValue(value.trim(), 250);
  const results = useSearch(workspaceId, q);
  const hits = results.data?.items ?? [];

  return (
    <div className="relative ml-auto max-w-[460px] flex-[1_1_260px]">
      <label htmlFor="board-search" className="sr-only">
        Search tasks
      </label>
      <Search
        aria-hidden="true"
        className="absolute top-3.5 left-3.5 size-4 text-muted-foreground"
      />
      <input
        id="board-search"
        type="search"
        value={value}
        autoComplete="off"
        placeholder="Search the workspace"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        className="h-11 w-full rounded-[14px] border border-input bg-white/4 pr-3.5 pl-10 outline-none focus-visible:border-primary"
      />
      {open && q ? (
        <div className="absolute top-12 right-0 left-0 z-30 overflow-hidden rounded-2xl border border-white/12 bg-popover/95 shadow-2xl backdrop-blur-lg">
          {results.isPending ? (
            <p className="p-4 text-sm text-muted-foreground">Searching…</p>
          ) : hits.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No tasks match “{q}”.</p>
          ) : (
            <ul aria-label="Search results">
              {hits.map((hit) => (
                <li key={hit.task.id}>
                  <Link
                    to={`/w/${workspaceId}/p/${hit.task.projectId}?task=${hit.task.id}`}
                    // mousedown fires before the input's blur closes the list.
                    onMouseDown={(e) => {
                      e.preventDefault();
                    }}
                    onClick={() => {
                      setOpen(false);
                    }}
                    className="flex flex-col gap-1 px-4 py-3 text-foreground no-underline hover:bg-white/6"
                  >
                    <span className="flex gap-2">
                      <span className="font-mono text-xs text-primary">{hit.task.key}</span>
                      <span className="truncate text-sm font-semibold">{hit.task.title}</span>
                    </span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {parseHeadline(hit.headline).map((part, i) =>
                        part.hit ? (
                          <mark key={i} className="rounded bg-primary/25 px-0.5 text-foreground">
                            {part.text}
                          </mark>
                        ) : (
                          <span key={i}>{part.text}</span>
                        ),
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
