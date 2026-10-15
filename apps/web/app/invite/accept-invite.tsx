'use client';

import {
  apiErrorSchema,
  type Invitation,
  invitationSchema,
} from '@joinpath/core';
import { motion, useReducedMotion } from 'motion/react';
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import { Envelope, Eye, EyeSlash, LinkBroken, Lock } from 'reicon-react';
import { EASE_OUT, SPRING_LAYOUT } from '@/components/beui/lib/ease';
import { cn } from '@/components/beui/lib/utils';
import {
  Alert,
  AlertContent,
  AlertIcon,
  AlertTitle,
} from '@/components/beui/motion/alert';
import { Button, ButtonLink } from '@/components/beui/motion/button/base';
import { Card } from '@/components/beui/motion/card';
import { Input } from '@/components/beui/motion/input';
import { Notice } from '@/components/notice';
import { api, ApiError } from '@/lib/api';
import {
  capitalized,
  firstName,
  formatDate,
  formatDateIn,
  formatTimeIn,
  inWords,
} from '@/lib/format';

type Page =
  | { state: 'opening' }
  | { state: 'gone' }
  | { state: 'failed'; message: string }
  | { state: 'open'; token: string; invitation: Invitation };

const RATE_LIMITED = 'Too many attempts. Wait a minute, then try again.';
const OFFLINE = "Couldn't reach Joinpath. Check your connection and try again.";

// The token after # in the address; the server renders without one.
const onHashChange = (change: () => void) => {
  window.addEventListener('hashchange', change);
  return () => window.removeEventListener('hashchange', change);
};

/**
 * Where an invitation link lands (PLAN §8): the token comes after #, so no server ever sees
 * it. Setting a password signs the new hire in, in place of whoever was signed in here.
 */
export function AcceptInvite() {
  const token = useSyncExternalStore(
    onHashChange,
    () => window.location.hash.slice(1),
    () => null,
  );
  const [page, setPage] = useState<Page>({ state: 'opening' });

  useEffect(() => {
    if (!token) return;
    let current = true;
    api('/auth/invitations/lookup', invitationSchema, {
      method: 'POST',
      body: { token },
    }).then(
      (invitation) => {
        if (!current) return;
        // Out of the address bar and history once the API has answered; a reload then
        // asks for the email again. A try that got no answer keeps it for the reload.
        history.replaceState(null, '', location.pathname);
        setPage({ state: 'open', token, invitation });
      },
      (error) => {
        if (!current) return;
        if (error instanceof ApiError && [400, 410].includes(error.status)) {
          history.replaceState(null, '', location.pathname);
          setPage({ state: 'gone' });
        } else {
          setPage({
            state: 'failed',
            message:
              error instanceof ApiError
                ? error.status === 429
                  ? RATE_LIMITED
                  : error.message
                : OFFLINE,
          });
        }
      },
    );
    return () => {
      current = false;
    };
  }, [token]);

  switch (page.state) {
    case 'opening':
      // No token at all, as after a reload once the token has left the address bar.
      return token === '' ? (
        <Dead
          icon={<Envelope className="size-5" />}
          tint="bg-primary/8 text-primary-strong"
          title="Open your invitation again"
          text="This page needs the link from your invitation email. Open the email and select Accept invitation."
        />
      ) : (
        <main className="px-4 pt-24 text-center">
          <output className="text-sm text-muted-foreground">
            Opening your invitation…
          </output>
        </main>
      );
    case 'gone':
      return (
        <Dead
          icon={<LinkBroken className="size-5" />}
          tint="bg-warning/10 text-warning-strong"
          title="This link no longer works"
          text="It was already used, it ran out, or a newer invitation replaced it. Ask your HR team to send you a new one."
        />
      );
    case 'failed':
      return (
        <main className="mx-auto max-w-115 px-4 pt-12 md:pt-24">
          <Notice
            variant="destructive"
            title="Couldn't open your invitation"
            text={page.message}
          />
        </main>
      );
    case 'open':
      return (
        <Welcome
          token={page.token}
          invitation={page.invitation}
          onGone={() => setPage({ state: 'gone' })}
        />
      );
  }
}

function Dead({
  icon,
  tint,
  title,
  text,
}: {
  icon: ReactNode;
  tint: string;
  title: string;
  text: string;
}) {
  return (
    <main className="px-4 pt-12 pb-14 md:pt-24">
      <section className="mx-auto flex max-w-115 flex-col items-start gap-4 rounded-3xl border border-border px-6 py-8">
        <span
          className={cn(
            'flex size-10 items-center justify-center rounded-full',
            tint,
          )}
        >
          {icon}
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="text-base leading-[26px] text-muted-foreground">
            {text}
          </p>
        </div>
        <ButtonLink href="/login" variant="secondary">
          Already set your password? Sign in
        </ButtonLink>
      </section>
    </main>
  );
}

// "You can do the first two tasks today": the new hire's tasks open by today's business date.
function lead({ tasks, today }: Invitation) {
  const open = tasks.filter(({ availableOn }) => availableOn <= today).length;
  const then =
    open > 1
      ? `You can do the first ${inWords(open)} tasks today, from any device.`
      : open === 1
        ? 'You can do the first task today, from any device.'
        : tasks[0] &&
          `Your first task opens on ${formatDate(tasks[0].availableOn)}.`;
  return ['Set a password to start your onboarding.', then]
    .filter(Boolean)
    .join(' ');
}

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

function Welcome({
  token,
  invitation,
  onGone,
}: {
  token: string;
  invitation: Invitation;
  onGone: () => void;
}) {
  const { organization, employee, manager, startDate, tasks } = invitation;
  // What the new hire does before day 1, as the email names it; the rest opens from then.
  const early = tasks.filter(({ availableOn }) => availableOn < startDate);
  const later = tasks.length - early.length;
  const firstDay = [
    manager && `You report to ${manager.fullName}.`,
    later === 1
      ? 'One more task opens from that day on.'
      : later > 1 &&
        `${capitalized(inWords(later))} more tasks open from that day on.`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <main className="px-4 pt-12 pb-14 text-[15px] leading-6 md:px-6 md:pt-24 md:pb-22">
      <div className="mx-auto flex max-w-250 flex-wrap items-start justify-center gap-10">
        <div className="flex max-w-115 min-w-0 flex-[1_1_420px] flex-col gap-6">
          <span className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-10 items-center justify-center rounded-xl bg-foreground text-base font-semibold text-background"
            >
              {organization.name[0]}
            </span>
            <span className="flex flex-col">
              <span className="font-semibold">{organization.name}</span>
              <span className="text-[13px] leading-[18px] text-muted-foreground">
                on Joinpath
              </span>
            </span>
          </span>
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
              Welcome to {organization.name}, {firstName(employee.fullName)}
            </h1>
            <p className="text-base leading-[26px] text-muted-foreground">
              {lead(invitation)}
            </p>
          </div>
          <AccountForm token={token} invitation={invitation} onGone={onGone} />
        </div>
        <aside
          aria-labelledby="next"
          className="flex max-w-105 min-w-0 flex-[1_1_340px] flex-col gap-4 min-[848px]:pt-28"
        >
          <h2 id="next" className="text-[15px] leading-[21px] font-semibold">
            What happens next
          </h2>
          <ol className="flex flex-col gap-1">
            {early.map((task, i) => (
              <Step
                key={`${task.title}-${task.availableOn}`}
                mark={
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-medium text-primary-strong">
                    {i + 1}
                  </span>
                }
                title={task.title}
                text={[
                  task.description && sentence(task.description.split('\n')[0]),
                  `Due ${formatDate(task.dueOn)}.`,
                ]
                  .filter(Boolean)
                  .join(' ')}
              />
            ))}
            <Step
              mark={
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-background text-muted-foreground">
                  <Lock className="size-3.5" aria-hidden />
                </span>
              }
              title={`Your first day, ${formatDate(startDate)}`}
              text={firstDay}
            />
          </ol>
        </aside>
      </div>
    </main>
  );
}

function Step({
  mark,
  title,
  text,
}: {
  mark: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <li className="flex gap-3.5 rounded-2xl bg-card px-4 py-3.5">
      {mark}
      <span className="flex flex-col">
        <span className="font-medium">{title}</span>
        {text && (
          <span className="text-[13px] leading-5 text-muted-foreground">
            {text}
          </span>
        )}
      </span>
    </li>
  );
}

// beUI's signup-form meter (MIT, components/beui/LICENSE): length counts most, and mixing
// kinds of characters only nudges the score. It advises; length is the only rule (PLAN §9).
function strength(password: string) {
  if (password.length < 8) return 0;
  let score = 1;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((kind) =>
    kind.test(password),
  ).length;
  if (kinds >= 3) score += 1;
  return Math.min(score, 4);
}
const STRENGTH = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
const STRENGTH_COLOR = [
  'bg-destructive',
  'bg-destructive',
  'bg-warning',
  'bg-warning',
  'bg-success',
];

function AccountForm({
  token,
  invitation: { organization, employee, expiresAt },
  onGone,
}: {
  token: string;
  invitation: Invitation;
  onGone: () => void;
}) {
  const reduce = useReducedMotion();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Shown once a submit has been tried, and gone as soon as the field is right.
  const passwordError =
    password.length < 8
      ? 'Use at least 8 characters.'
      : password.length > 200
        ? 'Use at most 200 characters.'
        : undefined;
  const againError = again !== password ? "Passwords don't match." : undefined;
  const matches = again.length > 0 && again === password;
  const score = strength(password);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTried(true);
    if (passwordError || againError) return;
    setError(null);
    setPending(true);
    try {
      const res = await fetch('/api/auth/invitations/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) {
        // A full load: the cookie is the new hire's now, and nothing cached may outlive it.
        window.location.assign('/tasks');
        return;
      }
      if (res.status === 410) return onGone();
      const body = apiErrorSchema.safeParse(await res.json().catch(() => null));
      setError(
        res.status === 429
          ? RATE_LIMITED
          : body.success
            ? body.data.message
            : 'Something went wrong. Try again.',
      );
    } catch {
      setError(OFFLINE);
    }
    setPending(false);
  }

  return (
    <motion.form
      noValidate
      onSubmit={create}
      initial={
        reduce ? { opacity: 0 } : { opacity: 0, y: 8, filter: 'blur(4px)' }
      }
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: reduce ? 0.16 : 0.22, ease: EASE_OUT }}
    >
      <Card className="gap-5 rounded-3xl px-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-[-0.015em]">
            Create your account
          </h2>
          <p className="text-sm text-muted-foreground">
            You&apos;ll sign in with your work email.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <Input
            label="Email"
            type="email"
            value={employee.email}
            readOnly
            leftIcon={<Envelope />}
            classNames={{
              field: 'bg-card',
              input: 'font-mono text-sm text-foreground/80',
            }}
          />
          <div className="flex flex-col gap-1.5">
            <Input
              id="password"
              label="Create a password"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
              disabled={pending}
              error={tried && passwordError}
              aria-describedby={
                tried && passwordError
                  ? 'password-error password-help'
                  : 'password-help'
              }
              classNames={{ errorMessage: 'text-danger-strong' }}
              rightIcon={
                <button
                  type="button"
                  aria-label={show ? 'Hide password' : 'Show password'}
                  onClick={() => setShow(!show)}
                  className="rounded-full outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {show ? <EyeSlash /> : <Eye />}
                </button>
              }
            />
            <div
              id="password-help"
              className="flex min-h-4 flex-col gap-1.5 px-1"
            >
              {password ? (
                <>
                  <div aria-hidden className="flex gap-1.5">
                    {[0, 1, 2, 3].map((bar) => (
                      <span
                        key={bar}
                        className="h-1 flex-1 overflow-hidden rounded-full bg-muted-foreground/20"
                      >
                        <motion.span
                          initial={false}
                          animate={{ scaleX: bar < score ? 1 : 0 }}
                          transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                          className={cn(
                            'block h-full w-full origin-left rounded-full',
                            STRENGTH_COLOR[score],
                          )}
                        />
                      </span>
                    ))}
                  </div>
                  <p
                    aria-live="polite"
                    className="text-xs text-muted-foreground"
                  >
                    Password strength: {STRENGTH[score]}
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  At least 8 characters.
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Input
              id="again"
              label="Type it again"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={again}
              onChange={setAgain}
              disabled={pending}
              success={matches}
              error={tried && againError}
              aria-describedby={
                tried && againError ? 'again-error' : 'again-help'
              }
              classNames={{
                errorMessage: 'text-danger-strong',
                successIcon: 'text-success-strong',
              }}
            />
            <p
              id="again-help"
              aria-live="polite"
              className="min-h-4 px-1 text-xs text-success-strong"
            >
              {matches && 'Passwords match'}
            </p>
          </div>
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
        <div className="flex flex-col gap-3">
          <Button
            type="submit"
            size="lg"
            disabled={pending}
            className="w-full bg-primary-strong hover:bg-primary-strong/90"
          >
            {pending ? 'Creating your account…' : 'Create account and continue'}
          </Button>
          <p className="text-center text-[13px] leading-5 text-muted-foreground">
            This link works once. It expires{' '}
            {formatDateIn(expiresAt, organization.timezone)} at{' '}
            {formatTimeIn(expiresAt, organization.timezone)}.
          </p>
        </div>
      </Card>
    </motion.form>
  );
}
