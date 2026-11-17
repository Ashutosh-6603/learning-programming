import type { Board, BoardColumn, ServerMessage, Task } from '@/lib/api/types';

// Pure functions over the cached Board: optimistic moves and real-time events both go
// through here, so the React Query cache is always replaced, never mutated.

/** Byte-order compare, the same order as Postgres `COLLATE "C"` on fractional keys. */
const byPosition = (a: Task, b: Task) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

function withoutTask(columns: BoardColumn[], taskId: string): BoardColumn[] {
  return columns.map((c) =>
    c.tasks.some((t) => t.id === taskId)
      ? { ...c, tasks: c.tasks.filter((t) => t.id !== taskId) }
      : c,
  );
}

/** Insert or replace a task from the server, keeping its column sorted by position. */
export function upsertTask(board: Board, task: Task): Board {
  if (task.projectId !== board.project.id) return board;
  const columns = withoutTask(board.columns, task.id).map((c) =>
    c.id === task.columnId ? { ...c, tasks: [...c.tasks, task].sort(byPosition) } : c,
  );
  return { ...board, columns };
}

export function removeTask(board: Board, taskId: string): Board {
  return { ...board, columns: withoutTask(board.columns, taskId) };
}

/**
 * The optimistic half of a move: place the task right after `afterTaskId` (or first) in the
 * target column. The server's response carries the real fractional position.
 */
export function moveTask(
  board: Board,
  taskId: string,
  columnId: string,
  afterTaskId: string | null,
): Board {
  const task = board.columns.flatMap((c) => c.tasks).find((t) => t.id === taskId);
  if (!task) return board;
  const moved = { ...task, columnId };
  const columns = withoutTask(board.columns, taskId).map((c) => {
    if (c.id !== columnId) return c;
    const at = afterTaskId === null ? 0 : c.tasks.findIndex((t) => t.id === afterTaskId) + 1;
    return { ...c, tasks: [...c.tasks.slice(0, at), moved, ...c.tasks.slice(at)] };
  });
  return { ...board, columns };
}

/** Apply a WebSocket event. Returns the same object when the event doesn't touch the board. */
export function applyServerMessage(board: Board, message: ServerMessage): Board {
  switch (message.type) {
    case 'task.created':
    case 'task.updated':
    case 'task.moved':
      return upsertTask(board, message.payload);
    case 'task.deleted':
      return removeTask(board, message.payload.id);
    case 'column.created':
    case 'column.updated':
    case 'column.moved': {
      const col = message.payload;
      if (col.projectId !== board.project.id) return board;
      const existing = board.columns.find((c) => c.id === col.id);
      const merged: BoardColumn = { ...col, tasks: existing?.tasks ?? [] };
      const columns = [...board.columns.filter((c) => c.id !== col.id), merged].sort((a, b) =>
        a.position < b.position ? -1 : a.position > b.position ? 1 : 0,
      );
      return { ...board, columns };
    }
    case 'column.deleted':
      return { ...board, columns: board.columns.filter((c) => c.id !== message.payload.id) };
    default:
      return board;
  }
}

/**
 * Converts a drop ("put it before card X", or before nothing = at the end) into the API's
 * `afterTaskId`. The dragged card is left out first, so dropping a card where it already is
 * produces its current neighbour, not itself.
 */
export function afterTaskIdFor(
  tasks: Task[],
  draggedId: string,
  beforeId: string | null,
): string | null {
  // "Before the dragged card itself" means "where it already is": before its current successor.
  const self = tasks.findIndex((t) => t.id === draggedId);
  const before = beforeId === draggedId ? (tasks[self + 1]?.id ?? null) : beforeId;
  const others = tasks.filter((t) => t.id !== draggedId);
  const index = before === null ? others.length : others.findIndex((t) => t.id === before);
  if (index === -1) return others.at(-1)?.id ?? null;
  return others[index - 1]?.id ?? null;
}

/** The keyboard/button alternative to dragging: to the end of the previous or next column. */
export function neighbourMove(
  board: Board,
  taskId: string,
  direction: -1 | 1,
): { columnId: string; afterTaskId: string | null } | null {
  const from = board.columns.findIndex((c) => c.tasks.some((t) => t.id === taskId));
  const target = board.columns[from + direction];
  if (from === -1 || !target) return null;
  return { columnId: target.id, afterTaskId: target.tasks.at(-1)?.id ?? null };
}
