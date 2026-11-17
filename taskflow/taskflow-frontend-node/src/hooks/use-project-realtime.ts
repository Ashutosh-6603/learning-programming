import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { Board, UserSummary } from '@/lib/api/types';
import { applyServerMessage } from '@/lib/board-cache';
import { keys } from '@/lib/queries/keys';
import { ProjectSocket, type SocketStatus } from '@/lib/realtime/project-socket';

/** Keeps the board query live: WebSocket events patch the cache, presence is local state. */
export function useProjectRealtime(projectId: string) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [present, setPresent] = useState<UserSummary[]>([]);

  useEffect(() => {
    const socket = new ProjectSocket(projectId, {
      onStatus: setStatus,
      onMessage: (message) => {
        if (message.type === 'subscribed') {
          // Events published while we were (re)connecting are gone: refetch to close the gap.
          void qc.invalidateQueries({ queryKey: keys.board(projectId) });
        } else if (message.type === 'presence.updated') {
          setPresent(message.payload.users);
        } else if (message.type === 'comment.created') {
          void qc.invalidateQueries({ queryKey: keys.comments(message.payload.comment.taskId) });
        } else {
          qc.setQueryData<Board>(keys.board(projectId), (board) =>
            board ? applyServerMessage(board, message) : board,
          );
          if ('payload' in message && 'key' in message.payload) {
            qc.setQueryData(keys.task(message.payload.id), message.payload);
          }
        }
      },
    });
    socket.start();
    return () => {
      socket.stop();
    };
  }, [projectId, qc]);

  return { status, present };
}
