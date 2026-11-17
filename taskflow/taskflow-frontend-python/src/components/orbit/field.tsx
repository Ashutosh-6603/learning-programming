import type { ComponentProps, ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type FieldProps = ComponentProps<typeof Input> & {
  id: string;
  label: string;
  error?: string | undefined;
  /** A control drawn inside the input's right edge, such as the show-password button. */
  trailing?: ReactNode;
};

/** Label + input + error, wired for screen readers (aria-invalid, aria-describedby). */
export function Field({ id, label, error, trailing, className, ...input }: FieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-muted-foreground">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn('h-12 rounded-xl bg-background/60 px-3.5', trailing && 'pr-12', className)}
          {...input}
        />
        {trailing}
      </div>
      {error ? (
        <span id={errorId} className="text-sm text-coral">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function FormAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-xl border border-coral/40 bg-coral/10 px-3.5 py-2.5 text-sm text-coral"
    >
      {message}
    </p>
  );
}
