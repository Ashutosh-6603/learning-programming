import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Wordmark } from '@/components/orbit/brand';
import { PrimaryButton } from '@/components/orbit/primary-button';
import { ApiError } from '@/lib/api/client';
import { workspacesApi } from '@/lib/api/endpoints';
import { useAuth } from '@/stores/auth';

function explain(err: unknown): string {
  if (err instanceof ApiError && err.status === 404)
    return 'This invitation is invalid, expired, revoked or already used.';
  if (err instanceof ApiError && err.status === 403)
    return 'This invitation was sent to a different email address.';
  return 'Something went wrong. Try again.';
}

export function AcceptInvitationPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();
  const accept = useMutation({
    mutationFn: () => workspacesApi.acceptInvitation(token),
    onSuccess: (workspace) => void navigate(`/w/${workspace.id}`, { replace: true }),
  });

  return (
    <main className="grid min-h-svh place-items-center px-6">
      <div className="flex w-full max-w-md flex-col gap-6 rounded-3xl border border-white/10 bg-white/4 p-8 backdrop-blur-xl">
        <Wordmark />
        <h1 className="font-display text-3xl font-bold">You’ve been invited</h1>
        <p className="text-muted-foreground">
          Accepting adds <strong className="text-foreground">{user?.email}</strong> to the
          workspace.
        </p>
        {accept.isError ? (
          <p role="alert" className="text-coral">
            {explain(accept.error)}
          </p>
        ) : null}
        <PrimaryButton
          disabled={!token || accept.isPending}
          onClick={() => {
            accept.mutate();
          }}
        >
          {accept.isPending ? 'Joining…' : 'Accept invitation'}
        </PrimaryButton>
        <Link to="/" className="text-center text-sm">
          Not now
        </Link>
      </div>
    </main>
  );
}
