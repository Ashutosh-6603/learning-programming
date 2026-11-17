import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { OrbitMark } from '@/components/orbit/brand';
import { Field, FormAlert } from '@/components/orbit/field';
import { OrbitHero } from '@/components/orbit/orbit-hero';
import { PasswordField } from '@/components/orbit/password-field';
import { authApi } from '@/lib/api/endpoints';
import { applyProblem } from '@/lib/forms';
import { loginSchema, registerSchema, type LoginValues, type RegisterValues } from '@/lib/schemas';
import { startSession } from '@/lib/session';
import { useAuth } from '@/stores/auth';

/** Only same-site paths: an open redirect (?next=https://evil.example) would be a phishing aid. */
function safeNext(next: string | null): string {
  return next?.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function LoginForm({ onDone }: { onDone: () => void }) {
  const [alert, setAlert] = useState<string | null>(null);
  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setAlert(null);
    try {
      startSession(await authApi.login(values));
      onDone();
    } catch (err) {
      setAlert(applyProblem(err, ['email', 'password'], form.setError));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5">
      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...form.register('email')}
      />
      <PasswordField
        id="password"
        label="Password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...form.register('password')}
      />
      <FormAlert message={alert} />
      <LaunchButton busy={isSubmitting}>Launch</LaunchButton>
    </form>
  );
}

function RegisterForm({ onDone }: { onDone: () => void }) {
  const [alert, setAlert] = useState<string | null>(null);
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: '', email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setAlert(null);
    try {
      startSession(await authApi.register(values));
      onDone();
    } catch (err) {
      setAlert(applyProblem(err, ['displayName', 'email', 'password'], form.setError));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5">
      <Field
        id="displayName"
        label="Name"
        autoComplete="name"
        error={errors.displayName?.message}
        {...form.register('displayName')}
      />
      <Field
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...form.register('email')}
      />
      <PasswordField
        id="password"
        label="Password"
        autoComplete="new-password"
        error={errors.password?.message}
        {...form.register('password')}
      />
      <FormAlert message={alert} />
      <LaunchButton busy={isSubmitting}>Create account</LaunchButton>
    </form>
  );
}

function LaunchButton({ busy, children }: { busy: boolean; children: string }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="animate-pulse-ring flex h-[52px] items-center justify-center gap-2.5 rounded-[14px] bg-primary font-display text-base font-bold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-60"
    >
      {busy ? 'Launching…' : children}
      <ArrowRight className="size-[18px]" strokeWidth={2.4} />
    </button>
  );
}

export function LaunchPage({ mode }: { mode: 'login' | 'register' }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const signedIn = useAuth((s) => s.accessToken !== null);
  const next = safeNext(params.get('next'));
  const query = params.toString() ? `?${params.toString()}` : '';

  if (signedIn) return <Navigate to={next} replace />;
  const onDone = () => void navigate(next, { replace: true });

  return (
    <main className="flex min-h-svh flex-wrap items-center justify-center gap-12 px-6 py-12">
      <div className="animate-rise flex max-w-[520px] flex-[1_1_420px] flex-col gap-7">
        <div className="flex items-center gap-3">
          <OrbitMark />
          <span className="font-display text-xl font-bold tracking-tight">TaskFlow</span>
          <span className="rounded-full border border-white/16 px-2.5 font-mono text-[11px] text-muted-foreground">
            orbit
          </span>
        </div>
        <h1 className="font-display text-[clamp(44px,6vw,76px)] leading-[0.98] font-bold tracking-[-0.04em]">
          Your work,
          <br />
          in orbit.
        </h1>
        <p className="max-w-[440px] text-[17px] text-[#b6bdcb]">
          Every project is a world, every task a body in motion. Drag work across space, and watch
          your team move with it in real time.
        </p>
        <div className="flex max-w-[420px] flex-col gap-4 rounded-[20px] border border-white/10 bg-white/4 p-[22px] backdrop-blur-xl">
          <nav
            aria-label="Account"
            className="grid grid-cols-2 gap-1 rounded-xl bg-background/60 p-1"
          >
            {(['login', 'register'] as const).map((m) => (
              <Link
                key={m}
                to={`/${m}${query}`}
                replace
                aria-current={mode === m ? 'page' : undefined}
                className="rounded-lg py-2 text-center text-sm font-semibold text-muted-foreground no-underline aria-[current=page]:bg-white/10 aria-[current=page]:text-foreground"
              >
                {m === 'login' ? 'Sign in' : 'Create account'}
              </Link>
            ))}
          </nav>
          {mode === 'login' ? <LoginForm onDone={onDone} /> : <RegisterForm onDone={onDone} />}
        </div>
      </div>
      <OrbitHero />
    </main>
  );
}
