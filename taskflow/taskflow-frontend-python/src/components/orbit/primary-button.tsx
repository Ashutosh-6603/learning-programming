import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** The Orbit lime call-to-action. shadcn's Button stays for small, quiet controls. */
export function PrimaryButton({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      className={cn(
        'inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-primary px-5 font-display font-bold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-40',
        className,
      )}
      {...props}
    />
  );
}

export function GhostButton({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      className={cn(
        'inline-flex h-11 items-center justify-center gap-2 rounded-[14px] border border-input px-4 hover:bg-white/8 disabled:opacity-40',
        className,
      )}
      {...props}
    />
  );
}
