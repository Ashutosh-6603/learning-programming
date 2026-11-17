import { Link } from 'react-router';

/** The API answers 404 (not 403) to non-members, so it doesn't reveal the workspace exists. */
export function NotMember() {
  return (
    <main className="grid min-h-svh place-items-center px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="font-display text-3xl font-bold">Lost in space</h1>
        <p className="text-muted-foreground">This doesn’t exist, or you’re not a member of it.</p>
        <Link to="/" className="font-semibold">
          Back to your workspaces
        </Link>
      </div>
    </main>
  );
}
