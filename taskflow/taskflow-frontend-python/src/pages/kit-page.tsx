import { Avatar, PriorityPill, RolePill } from '@/components/orbit/badges';
import { Wordmark } from '@/components/orbit/brand';
import { Field } from '@/components/orbit/field';
import { PasswordField } from '@/components/orbit/password-field';
import { Planet } from '@/components/orbit/planet';
import { GhostButton, PrimaryButton } from '@/components/orbit/primary-button';
import { Starfield } from '@/components/orbit/starfield';

const SWATCHES = [
  'bg-background',
  'bg-card',
  'bg-muted',
  'bg-primary',
  'bg-sky',
  'bg-amber',
  'bg-coral',
];

const ADA = {
  id: '01900000-0000-7000-8000-0000000000ad',
  email: 'ada@test.com',
  displayName: 'Ada',
};

/** The dev-only style guide at /kit: the theme and every Orbit building block on one page. */
export function KitPage() {
  return (
    <main className="flex min-h-svh flex-col items-start gap-6 p-10">
      <Starfield />
      <Wordmark />
      <h1 className="font-display text-3xl font-semibold">Orbit kit</h1>
      <div className="flex flex-wrap gap-3">
        {SWATCHES.map((swatch) => (
          <div key={swatch} className="flex flex-col items-center gap-1 text-xs">
            <span className={`size-12 rounded-xl border border-border ${swatch}`} />
            {swatch.slice(3)}
          </div>
        ))}
      </div>
      <p className="text-muted-foreground">
        Inter for text, <span className="font-display">Space Grotesk for display</span>,{' '}
        <span className="font-mono">JetBrains Mono for TF-42</span>.
      </p>
      <Planet id="01900000-0000-7000-8000-00000000c0de" />
      <div className="flex items-center gap-2">
        <Avatar user={ADA} />
        <PriorityPill priority="urgent" />
        <PriorityPill priority="medium" />
        <RolePill role="owner" />
      </div>
      <div className="flex w-80 flex-col gap-4">
        <Field id="kit-email" label="Email" error="Enter a valid email address" />
        <PasswordField id="kit-password" label="Password" />
      </div>
      <div className="flex gap-2">
        <PrimaryButton>Launch</PrimaryButton>
        <GhostButton>Cancel</GhostButton>
      </div>
    </main>
  );
}
