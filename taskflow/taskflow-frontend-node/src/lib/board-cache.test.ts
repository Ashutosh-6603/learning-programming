import { describe, expect, it } from 'vitest';
import { makeBoard, makeTask } from '@/test/fixtures';
import {
  afterTaskIdFor,
  applyServerMessage,
  moveTask,
  neighbourMove,
  upsertTask,
} from './board-cache';

const ids = (board: ReturnType<typeof makeBoard>) =>
  board.columns.map((c) => c.tasks.map((t) => t.id));

describe('upsertTask', () => {
  it('replaces a task and keeps its column sorted by position', () => {
    const board = upsertTask(
      makeBoard(),
      makeTask({ id: 't1', number: 1, columnId: 'c1', position: 'a2' }),
    );
    expect(ids(board)).toEqual([['t2', 't1'], ['t3'], []]);
  });

  it('ignores tasks from another project', () => {
    const board = makeBoard();
    expect(
      upsertTask(board, makeTask({ id: 'x', columnId: 'c1', position: 'a', projectId: 'other' })),
    ).toBe(board);
  });
});

describe('moveTask (optimistic)', () => {
  it('moves to the top of a column when afterTaskId is null', () => {
    expect(ids(moveTask(makeBoard(), 't3', 'c1', null))).toEqual([['t3', 't1', 't2'], [], []]);
  });

  it('moves right after the given task', () => {
    expect(ids(moveTask(makeBoard(), 't3', 'c1', 't1'))).toEqual([['t1', 't3', 't2'], [], []]);
  });

  it('does not mutate the input', () => {
    const board = makeBoard();
    moveTask(board, 't1', 'c3', null);
    expect(ids(board)).toEqual([['t1', 't2'], ['t3'], []]);
  });
});

describe('afterTaskIdFor', () => {
  const tasks = makeBoard().columns[0]?.tasks ?? [];

  it('drops at the end after the last other task', () => {
    expect(afterTaskIdFor(tasks, 't3', null)).toBe('t2');
    expect(afterTaskIdFor(tasks, 't2', null)).toBe('t1');
  });

  it('drops before a card after that card’s predecessor', () => {
    expect(afterTaskIdFor(tasks, 't3', 't1')).toBeNull();
    expect(afterTaskIdFor(tasks, 't3', 't2')).toBe('t1');
  });

  it('treats “before myself” as staying put', () => {
    expect(afterTaskIdFor(tasks, 't2', 't2')).toBe('t1');
  });
});

describe('neighbourMove', () => {
  it('targets the end of the adjacent column', () => {
    expect(neighbourMove(makeBoard(), 't3', -1)).toEqual({ columnId: 'c1', afterTaskId: 't2' });
    expect(neighbourMove(makeBoard(), 't3', 1)).toEqual({ columnId: 'c3', afterTaskId: null });
  });

  it('returns null at the edges', () => {
    expect(neighbourMove(makeBoard(), 't1', -1)).toBeNull();
  });
});

describe('applyServerMessage', () => {
  it('applies task.moved and is idempotent', () => {
    const moved = makeTask({ id: 't1', number: 1, columnId: 'c3', position: 'a0' });
    const message = { type: 'task.moved' as const, payload: moved, ts: '' };
    const once = applyServerMessage(makeBoard(), message);
    expect(ids(applyServerMessage(once, message))).toEqual(ids(once));
    expect(ids(once)).toEqual([['t2'], ['t3'], ['t1']]);
  });

  it('removes deleted tasks and columns', () => {
    const board = applyServerMessage(makeBoard(), {
      type: 'task.deleted',
      payload: { id: 't3', projectId: 'p1', columnId: 'c2' },
      ts: '',
    });
    expect(ids(board)).toEqual([['t1', 't2'], [], []]);
    expect(
      applyServerMessage(board, {
        type: 'column.deleted',
        payload: { id: 'c3', projectId: 'p1' },
        ts: '',
      }).columns,
    ).toHaveLength(2);
  });

  it('returns the same board for events that do not touch it', () => {
    const board = makeBoard();
    expect(applyServerMessage(board, { type: 'pong', ts: '' })).toBe(board);
  });
});
