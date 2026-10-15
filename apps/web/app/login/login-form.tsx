'use client';

import {
  apiErrorSchema,
  type ErrorCode,
  loginSchema,
  meSchema,
} from '@joinpath/core';
import { motion, useReducedMotion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { Envelope, Eye, EyeSlash } from 'reicon-react';
import { EASE_OUT } from '@/components/beui/lib/ease';
import {
  Alert,
  AlertContent,
  AlertIcon,
  AlertTitle,
} from '@/components/beui/motion/alert';
import { Button } from '@/components/beui/motion/button/base';
import { Card } from '@/components/beui/motion/card';
import { Input } from '@/components/beui/motion/input';
import { homeFor } from '@/lib/nav';

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  UNAUTHENTICATED: 'Invalid email or password.',
  RATE_LIMITED: 'Too many attempts. Wait a minute, then try again.',
};
const FALLBACK = 'Something went wrong. Try again.';

export function LoginForm() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [invalid, setInvalid] = useState({ email: false, password: false });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const fields = parsed.error.issues.map((issue) => issue.path[0]);
      setInvalid({
        email: fields.includes('email'),
        password: fields.includes('password'),
      });
      return;
    }
    setInvalid({ email: false, password: false });
    setError(null);
    setPending(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        const body = apiErrorSchema.safeParse(
          await res.json().catch(() => null),
        );
        setError((body.success && MESSAGES[body.data.code]) || FALLBACK);
        setPending(false);
        return;
      }
      const me = meSchema.parse(await (await fetch('/api/auth/me')).json());
      router.replace(homeFor(me));
    } catch {
      setError("Couldn't reach Joinpath. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <motion.form
      noValidate
      onSubmit={signIn}
      initial={
        reduce ? { opacity: 0 } : { opacity: 0, y: 8, filter: 'blur(4px)' }
      }
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: reduce ? 0.16 : 0.22, ease: EASE_OUT }}
      className="w-full max-w-100"
    >
      <Card className="gap-5 rounded-3xl px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-[-0.015em]">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            Use the account your company set up for you.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <Input
            label="Work email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
            leftIcon={<Envelope />}
            error={invalid.email && 'Enter your work email.'}
            reserveErrorLine
            classNames={{ errorMessage: 'text-danger-strong' }}
          />
          <Input
            label="Password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
            aria-describedby="password-hint"
            error={invalid.password && 'Enter your password.'}
            classNames={{ errorMessage: 'text-danger-strong' }}
            rightIcon={
              <button
                type="button"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword(!showPassword)}
                className="rounded-full outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                {showPassword ? <EyeSlash /> : <Eye />}
              </button>
            }
          />
          <p
            id="password-hint"
            className="min-h-4 px-1 text-xs text-muted-foreground"
          >
            Forgot it? Ask HR to send a new invitation.
          </p>
        </div>
        <Alert
          variant="destructive"
          open={error !== null}
          className="text-danger-strong"
        >
          <AlertIcon />
          <AlertContent>
            <AlertTitle>{error}</AlertTitle>
          </AlertContent>
        </Alert>
        <Button
          type="submit"
          size="lg"
          disabled={pending}
          className="w-full bg-primary-strong hover:bg-primary-strong/90"
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </Card>
    </motion.form>
  );
}
