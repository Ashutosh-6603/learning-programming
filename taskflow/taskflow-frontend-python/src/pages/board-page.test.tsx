import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import type { Role } from '@/lib/api/types';
import { makeBoard, makeTask, makeWorkspace } from '@/test/fixtures';
import { renderRoutes } from '@/test/render';
import { api, server } from '@/test/server';
import { BoardPage } from './board-page';

// The socket has its own test; here the board must not try to open one.
vi.mock('@/hooks/use-project-realtime', () => ({
  useProjectRealtime: () => ({ status: 'live', present: [] }),
}));

function serve(role: Role) {
  server.use(
    http.get(api('/workspaces/w1'), () =>
      HttpResponse.json(makeWorkspace({ currentUserRole: role })),
    ),
    http.get(api('/projects/p1/board'), () => HttpResponse.json(makeBoard())),
    http.get(api('/workspaces/w1/members'), () =>
      HttpResponse.json({ items: [], nextCursor: null }),
    ),
  );
}

const renderBoard = (path = '/w/w1/p/p1') =>
  renderRoutes([{ path: '/w/:workspaceId/p/:projectId', element: <BoardPage /> }], path);

describe('BoardPage', () => {
  it('renders the columns and their cards', async () => {
    serve('member');
    renderBoard();
    const todo = await screen.findByRole('region', { name: 'To Do' });
    expect(within(todo).getByText('Task 1')).toBeInTheDocument();
    expect(within(todo).getByText('Task 2')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'In Progress' })).getByText('Task 3'),
    ).toBeInTheDocument();
  });

  it('moves a card forward optimistically and sends afterTaskId', async () => {
    serve('member');
    let body: unknown;
    server.use(
      http.post(api('/tasks/t1/move'), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(makeTask({ id: 't1', number: 1, columnId: 'c2', position: 'a1' }));
      }),
    );
    renderBoard();
    await userEvent.click(await screen.findByRole('button', { name: 'Move TF-1 forward' }));
    const doing = screen.getByRole('region', { name: 'In Progress' });
    expect(await within(doing).findByText('Task 1')).toBeInTheDocument();
    expect(body).toEqual({ columnId: 'c2', afterTaskId: 't3' });
  });

  it('puts the board back when the move fails', async () => {
    serve('member');
    server.use(
      http.post(api('/tasks/t1/move'), () =>
        HttpResponse.json({ type: 'x', title: 'Conflict', status: 409 }, { status: 409 }),
      ),
    );
    renderBoard();
    await userEvent.click(await screen.findByRole('button', { name: 'Move TF-1 forward' }));
    const todo = screen.getByRole('region', { name: 'To Do' });
    expect(await within(todo).findByText('Task 1')).toBeInTheDocument();
  });

  it('hides editing controls from viewers', async () => {
    serve('viewer');
    renderBoard();
    await screen.findByText('Task 1');
    expect(screen.queryByRole('button', { name: 'Move TF-1 forward' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('New task title')).not.toBeInTheDocument();
  });

  it('opens the task from ?task= in the URL', async () => {
    serve('member');
    server.use(
      http.get(api('/tasks/t2/comments'), () => HttpResponse.json({ items: [], nextCursor: null })),
    );
    renderBoard('/w/w1/p/p1?task=t2');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('TF-2')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Task 2');
  });
});
