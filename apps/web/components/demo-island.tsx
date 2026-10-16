'use client';

import {
  clockSchema,
  type Demo,
  type DemoPersonKind,
  type Me,
  meSchema,
} from '@joinpath/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from 'react';
import {
  AlertCircle,
  Calendar,
  ChevronDown,
  Envelope,
  FastForward,
  ForwardStep,
  Loader,
  Restart,
} from 'reicon-react';
import { Avatar, newHireTint, ROLE_TINT } from '@/components/avatar';
import { cn } from '@/components/beui/lib/utils';
import { Button, ButtonLink } from '@/components/beui/motion/button/base';
import {
  DynamicIsland,
  DynamicIslandView,
} from '@/components/beui/motion/dynamic-island';
import { api } from '@/lib/api';
import { demoErrorOf, goHome, startDemo } from '@/lib/demo';
import {
  daysBetween,
  firstName,
  formatDate,
  formatDateLong,
  formatMonthDay,
} from '@/lib/format';

type Person = Demo['people'][number];

const LABEL: Record<DemoPersonKind, string> = {
  HR: 'HR',
  IT: 'IT',
  MANAGER: 'Manager',
  MEMBER: 'Member',
  NEW_HIRE: 'New hire',
};
// One text node, "Lan · HR": in a flex box, separate ones would lose the spaces around the dot.
const nameOf = ({ fullName, kind }: Person) =>
  `${firstName(fullName)} · ${LABEL[kind]}`;
// As the pill reads out: "Lan Pham, HR", "Minh Nguyen, manager".
const spoken = ({ fullName, kind }: Person) =>
  `${fullName}, ${kind === 'HR' || kind === 'IT' ? kind : LABEL[kind].toLowerCase()}`;

// On the dark island the background is the ink: labels at 60%, controls on 15%, hovered 20%.
const CAPTION =
  'text-[10px] leading-3.5 tracking-[0.08em] text-background/60 uppercase';
const CONTROL =
  'bg-background/15 text-background hover:bg-background/20 hover:text-background';
// A chip there only to read keeps still under the pointer.
const STILL = { whileHover: {}, whileTap: {} };

const spinner = (
  <Loader className="size-3.5 animate-spin motion-reduce:animate-none" />
);

/** Initials on the person's tint, the role's or the new hire's, over the white tints are made for. */
function Face({ person, className }: { person: Person; className: string }) {
  const tint =
    person.kind === 'NEW_HIRE'
      ? newHireTint(person.employeeId)
      : ROLE_TINT[
          person.kind === 'HR' || person.kind === 'IT' ? person.kind : 'MEMBER'
        ];
  return (
    <span className={cn('shrink-0 rounded-full bg-background', className)}>
      <Avatar
        name={person.fullName}
        className={cn('size-full text-[10px]', tint)}
      />
    </span>
  );
}

/**
 * A control of the open island. While a request runs, none of them acts: its own spins, the
 * others dim. Not `disabled`, which would drop the focus of the one just pressed.
 */
function Control({
  busy,
  idle,
  icon,
  onClick,
  className,
  children,
  ...props
}: ComponentProps<typeof Button> & {
  busy: boolean;
  idle: boolean;
  icon: ReactNode;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-busy={busy || undefined}
      aria-disabled={!idle || undefined}
      onClick={idle ? onClick : undefined}
      className={cn(
        CONTROL,
        !idle && 'cursor-wait',
        !idle && !busy && 'opacity-50',
        className,
      )}
      {...props}
    >
      {busy ? spinner : icon}
      {children}
    </Button>
  );
}

// On the real clock (PLAN §4.6): the business date may run ahead, a sandbox's 24 hours don't.
function resetsIn(expiresAt: string) {
  const minutes = Math.floor((Date.parse(expiresAt) - Date.now()) / 60_000);
  return minutes >= 60
    ? `Resets in ${Math.floor(minutes / 60)} h`
    : minutes > 0
      ? `Resets in ${minutes} min`
      : 'Resets soon';
}

/**
 * The demo controls (PLAN §10) over the top of a sandbox's pages: the business date and who
 * the guest plays. Opened, they move the date on, play someone else, or start a new demo.
 * Goes right after the page's header, 64 px tall from 768 px.
 */
export function DemoIsland({
  me,
  demo,
  shell = false,
}: {
  me: Me;
  demo: Demo;
  /** In the app shell, whose header holds a breadcrumb beside a sidebar from 768 px. */
  shell?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  // The control whose request runs: 'day', 'jump', 'demo', or whom the guest plays next. The
  // others wait for it.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startRefresh] = useTransition();
  const island = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const backToPill = useRef(false);
  const waitingId = useId();
  const idle = busy === null;

  const { today } = me.organization;
  const self = demo.people.find(
    ({ employeeId }) => employeeId === me.employee.id,
  );
  const jump = demo.nextStartDate && daysBetween(today, demo.nextStartDate);
  const waiting = demo.people.filter(({ hasAccount }) => !hasAccount);

  // Opened, focus moves to the first control. Esc, or a click or focus outside, closes the
  // island; after Esc focus is back on the pill.
  useEffect(() => {
    if (!open) {
      if (backToPill.current) pill.current?.focus();
      backToPill.current = false;
      return;
    }
    island.current?.querySelector<HTMLElement>('dialog button')?.focus();
    const close = (refocus: boolean) => {
      backToPill.current = refocus;
      setOpen(false);
      setError(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(true);
    };
    const onLeave = (event: Event) => {
      if (!island.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onLeave);
    document.addEventListener('focusin', onLeave);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onLeave);
      document.removeEventListener('focusin', onLeave);
    };
  }, [open]);

  // Jump goes once its date comes, and the focus with it: back to +1 day.
  useEffect(() => {
    if (open && document.activeElement === document.body) {
      island.current?.querySelector<HTMLElement>('dialog button')?.focus();
    }
  }, [open, today]);

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(demoErrorOf(cause));
      setBusy(null);
    }
  }

  // The island stays open. Every page counts from the business date, so their data comes again,
  // and `me` with it; the control spins until the new date is on screen.
  const moveClock = (days: number) => async () => {
    await api('/demo/clock/advance', clockSchema, {
      method: 'POST',
      body: { days },
    });
    void queryClient.invalidateQueries();
    startRefresh(() => {
      router.refresh();
      setBusy(null);
    });
  };

  const play = (employeeId: string) => async () =>
    goHome(
      await api('/demo/switch-user', meSchema, {
        method: 'POST',
        body: { employeeId },
      }),
    );

  return (
    // A row of its own under the header while the header has no room for it: on a phone, and
    // in the app shell below 1024 px, where it covered the breadcrumb. Then over the header:
    // in its middle, but in the app shell at its end until 1280 px, as a long breadcrumb fills
    // its middle. Opened, it grows down over the page.
    <div className={cn('relative h-[49px]', shell ? 'lg:h-0' : 'md:h-0')}>
      <div
        className={cn(
          'pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-4',
          shell
            ? 'lg:-top-[51px] lg:justify-end lg:px-8 xl:justify-center xl:px-4'
            : 'md:-top-[51px]',
        )}
      >
        <div ref={island} className="pointer-events-auto">
          <DynamicIsland
            view={open ? 'controls' : null}
            compactClassName="p-0"
            compact={
              <button
                ref={pill}
                type="button"
                aria-haspopup="dialog"
                aria-label={`Demo controls: ${formatDate(today)}${self ? `, viewing as ${spoken(self)}` : ''}`}
                onClick={() => setOpen(true)}
                className="flex min-h-[37px] items-center gap-2.5 rounded-full py-1.5 pr-2.5 pl-3.5 outline-none hover:bg-background/5 focus-visible:ring-2 focus-visible:ring-background/60 focus-visible:ring-inset active:bg-background/8"
              >
                <span className="size-1.5 rounded-full bg-accent" />
                {/* Not on a phone, where the pill would not fit: the dot says it alone. */}
                <span className="hidden md:inline">Demo</span>
                <span className="hidden h-3.5 w-px bg-background/20 md:block" />
                <span className="flex items-center gap-1.5 font-mono">
                  <Calendar className="size-[13px]" />
                  {formatDate(today)}
                </span>
                {self && (
                  <>
                    <span className="h-3.5 w-px bg-background/20" />
                    <span className="flex items-center gap-1.5">
                      <Face person={self} className="size-[22px]" />
                      {nameOf(self)}
                    </span>
                  </>
                )}
                <ChevronDown className="size-3 opacity-70" />
              </button>
            }
          >
            <DynamicIslandView id="controls" className="p-0">
              {/* Not modal: the page stays as it is, and the island closes when left. */}
              <dialog
                open
                aria-label="Demo controls"
                aria-busy={busy !== null}
                className={cn(
                  'static flex w-[540px] max-w-[calc(100vw-32px)] flex-col gap-[18px] bg-transparent px-6 pt-[18px] pb-[22px] text-background',
                  // No wider than the page's column beside the 256 px sidebar.
                  shell && 'md:max-w-[calc(100vw-288px)]',
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <span className="size-1.5 rounded-full bg-accent" />
                    {`Demo sandbox · ${me.organization.name}`}
                  </span>
                  {demo.expiresAt && (
                    <span className={CAPTION}>{resetsIn(demo.expiresAt)}</span>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <span className={CAPTION}>Business date</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* A line of its own on a phone, its buttons below. */}
                    <span className="w-full font-mono text-[15px] font-semibold tabular-nums md:w-auto md:flex-1">
                      {formatDateLong(today)}
                    </span>
                    <Control
                      busy={busy === 'day'}
                      idle={idle}
                      icon={<ForwardStep className="size-3.5" />}
                      onClick={() => run('day', moveClock(1))}
                    >
                      +1 day
                    </Control>
                    {/* To the next start date, if the demo clock can get there in one move. */}
                    {jump && jump <= 30 ? (
                      <Control
                        busy={busy === 'jump'}
                        idle={idle}
                        icon={<FastForward className="size-3.5" />}
                        onClick={() => run('jump', moveClock(jump))}
                      >
                        {`Jump to ${formatMonthDay(demo.nextStartDate!)}`}
                      </Control>
                    ) : null}
                  </div>
                </div>

                {/* Buttons, not radios: arrow keys in a radio group would play someone else, and
                  load their page, at every press. */}
                <fieldset className="min-w-0">
                  <legend className={cn(CAPTION, 'mb-2')}>Viewing as</legend>
                  <div className="flex flex-wrap gap-1.5">
                    {demo.people.map((person) => {
                      const current = person.employeeId === me.employee.id;
                      const playing = busy === person.employeeId;
                      // Oneself, and a new hire without an account yet, are there to read.
                      const inert = current || !person.hasAccount;
                      return (
                        <Button
                          key={person.employeeId}
                          size="sm"
                          variant="ghost"
                          aria-label={spoken(person)}
                          aria-pressed={current}
                          aria-disabled={
                            !person.hasAccount ||
                            (!idle && !current) ||
                            undefined
                          }
                          aria-describedby={
                            person.hasAccount ? undefined : waitingId
                          }
                          aria-busy={playing || undefined}
                          onClick={
                            inert || !idle
                              ? undefined
                              : () =>
                                  run(
                                    person.employeeId,
                                    play(person.employeeId),
                                  )
                          }
                          {...(inert ? STILL : {})}
                          className={cn(
                            'pl-1',
                            current
                              ? 'cursor-default bg-background text-foreground hover:bg-background hover:text-foreground'
                              : CONTROL,
                            !person.hasAccount &&
                              'cursor-not-allowed opacity-50 hover:bg-background/15',
                            !idle && !inert && 'cursor-wait',
                            !idle && !inert && !playing && 'opacity-50',
                          )}
                        >
                          {playing ? (
                            <span className="flex size-6 items-center justify-center rounded-full bg-background text-foreground">
                              {spinner}
                            </span>
                          ) : (
                            <Face person={person} className="size-6" />
                          )}
                          {nameOf(person)}
                        </Button>
                      );
                    })}
                  </div>
                  {waiting.length > 0 && (
                    <p
                      id={waitingId}
                      className="mt-2 text-xs text-background/60"
                    >
                      {new Intl.ListFormat('en').format(
                        waiting.map(({ fullName }) => fullName),
                      )}{' '}
                      {waiting.length === 1 ? 'has' : 'have'} no account yet:
                      new hires get one by accepting their invitation.
                    </p>
                  )}
                </fieldset>

                {error && (
                  <p
                    role="alert"
                    className="flex items-start gap-1.5 text-xs text-destructive"
                  >
                    <AlertCircle className="mt-px size-3.5 shrink-0" />
                    {error}
                  </p>
                )}

                <div className="flex flex-wrap gap-2 border-t border-background/10 pt-3">
                  <ButtonLink
                    href="/mock-inbox"
                    size="sm"
                    variant="ghost"
                    aria-disabled={!idle || undefined}
                    tabIndex={idle ? undefined : -1}
                    className={cn(
                      CONTROL,
                      !idle && 'pointer-events-none opacity-50',
                    )}
                  >
                    <Envelope className="size-3.5" />
                    Mock inbox
                  </ButtonLink>
                  <Control
                    busy={busy === 'demo'}
                    idle={idle}
                    icon={<Restart className="size-3.5" />}
                    onClick={() => run('demo', startDemo)}
                  >
                    {busy === 'demo'
                      ? 'Starting a new demo…'
                      : 'Start a new demo'}
                  </Control>
                </div>
              </dialog>
            </DynamicIslandView>
          </DynamicIsland>
        </div>
      </div>
    </div>
  );
}
