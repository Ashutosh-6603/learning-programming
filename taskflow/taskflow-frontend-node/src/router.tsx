import { createBrowserRouter, type RouteObject } from 'react-router';
import { RequireAuth } from '@/components/orbit/require-auth';
import { RootLayout } from '@/components/orbit/root-layout';
import { LaunchPage } from '@/pages/launch-page';
import { NotMember } from '@/pages/not-member';

// The launch page ships in the first bundle. Everything behind sign-in is split into chunks
// that load when first visited: `lazy` returns the route's Component from a dynamic import().
export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { path: '/login', element: <LaunchPage mode="login" /> },
      { path: '/register', element: <LaunchPage mode="register" /> },
      {
        element: <RequireAuth />,
        children: [
          {
            path: '/',
            lazy: async () => ({ Component: (await import('@/pages/orbit-page')).OrbitPage }),
          },
          {
            path: '/w/:workspaceId',
            lazy: async () => ({
              Component: (await import('@/pages/workspace-page')).WorkspacePage,
            }),
          },
          {
            path: '/w/:workspaceId/members',
            lazy: async () => ({ Component: (await import('@/pages/members-page')).MembersPage }),
          },
          {
            path: '/w/:workspaceId/p/:projectId',
            lazy: async () => ({ Component: (await import('@/pages/board-page')).BoardPage }),
          },
          {
            path: '/invitations/accept',
            lazy: async () => ({
              Component: (await import('@/pages/accept-invitation-page')).AcceptInvitationPage,
            }),
          },
        ],
      },
      { path: '*', element: <NotMember /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
