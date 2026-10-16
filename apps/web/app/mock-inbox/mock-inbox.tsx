'use client';

import { type Me, type MockEmail, mockEmailSchema } from '@joinpath/core';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { ChevronLeft, Route } from 'reicon-react';
import { cn } from '@/components/beui/lib/utils';
import { ButtonLink } from '@/components/beui/motion/button/base';
import { Tabs, TabsList, TabsTrigger } from '@/components/beui/motion/tabs';
import { DemoIsland } from '@/components/demo-island';
import { EmptyState } from '@/components/empty-state';
import { Notice } from '@/components/notice';
import { api, ApiError } from '@/lib/api';
import { formatMomentIn, formatShortMomentIn } from '@/lib/format';
import { homeFor } from '@/lib/nav';

const EVERYONE = 'everyone';

const paragraphs = (text: string) => (text ? text.split('\n\n') : []);

/**
 * Every email Joinpath would have sent in the org, newest first (PLAN §9). A tab per person
 * who got one, so the guest can play each part.
 */
export function MockInbox({ me }: { me: Me }) {
  const { name: orgName, timezone: timeZone, demo } = me.organization;
  // A query, so that +1 day and Jump on the island load it again: their tick may send more.
  const { data: emails, error } = useQuery({
    queryKey: ['mock-inbox'],
    queryFn: () => api('/mock-inbox', mockEmailSchema.array()),
  });
  const [tab, setTab] = useState(EVERYONE);
  const [openId, setOpenId] = useState<string>();

  // In the order of their newest email.
  const recipients = [
    ...new Map(emails?.map((email) => [email.toEmail, email.toName])),
  ];
  const shown =
    tab === EVERYONE
      ? (emails ?? [])
      : (emails ?? []).filter(({ toEmail }) => toEmail === tab);
  const open = shown.find(({ id }) => id === openId) ?? shown[0];

  return (
    <div className="text-sm">
      <header className="flex h-16 items-center border-b border-border px-6">
        <Link
          href={homeFor(me)}
          className="-ml-3 inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground active:bg-foreground/8"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          Back to Joinpath
        </Link>
      </header>
      {demo && <DemoIsland me={me} demo={demo} />}
      <main className="px-4 pt-8 pb-16 md:px-6">
        <div className="mx-auto flex max-w-310 flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-2">
              <h1 className="text-3xl font-semibold tracking-tight">
                Mock inbox
              </h1>
              <p className="max-w-160 leading-[23px] text-muted-foreground">
                Joinpath never sends real email in the demo. Every message to
                anyone in this sandbox lands here, so you can play each part.
              </p>
            </div>
            {recipients.length > 0 && (
              // Narrower than its tabs on a phone, it scrolls them, as beUI's list does.
              <Tabs
                value={tab}
                onValueChange={setTab}
                className="max-w-full min-w-0"
              >
                <TabsList aria-label="Recipients">
                  <TabsTrigger
                    value={EVERYONE}
                    indicatorClassName="bg-primary-strong"
                  >
                    Everyone
                  </TabsTrigger>
                  {recipients.map(([email, name]) => (
                    <TabsTrigger
                      key={email}
                      value={email}
                      indicatorClassName="bg-primary-strong"
                    >
                      {name}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            )}
          </div>
          {error ? (
            <Notice
              variant="destructive"
              title="Couldn't load the mock inbox"
              text={
                error instanceof ApiError
                  ? error.message
                  : 'Check your connection, then reload the page.'
              }
            />
          ) : emails?.length === 0 ? (
            <EmptyState
              title="No email yet"
              description="Invitations, new tasks, requests for changes and overdue reminders land here once Joinpath sends them."
            />
          ) : (
            open && (
              <div className="flex flex-wrap items-start gap-4">
                <section
                  aria-label="Messages"
                  className="min-w-0 flex-[1_1_360px] rounded-2xl border border-border p-2"
                >
                  <ul className="flex flex-col gap-0.5">
                    {shown.map((email) => (
                      <li key={email.id}>
                        <button
                          type="button"
                          aria-current={email === open || undefined}
                          onClick={() => setOpenId(email.id)}
                          className={cn(
                            'flex w-full flex-col gap-0.5 rounded-xl px-3.5 py-3 text-left transition-colors',
                            email === open
                              ? 'bg-card'
                              : 'hover:bg-foreground/5 active:bg-foreground/8',
                          )}
                        >
                          <span className="flex w-full justify-between gap-2">
                            <span className="font-semibold">
                              To {email.toName}
                            </span>
                            <span className="font-mono text-xs text-muted-foreground">
                              {formatShortMomentIn(email.sentAt, timeZone)}
                            </span>
                          </span>
                          <span className="font-medium">{email.subject}</span>
                          <span className="w-full truncate text-[13px] text-muted-foreground">
                            {paragraphs(email.body).slice(1).join(' ')}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
                <Message email={open} orgName={orgName} timeZone={timeZone} />
              </div>
            )
          )}
        </div>
      </main>
    </div>
  );
}

// The first paragraph greets, as every email opens; the small print's last paragraph sits
// below a rule.
function Message({
  email,
  orgName,
  timeZone,
}: {
  email: MockEmail;
  orgName: string;
  timeZone: string;
}) {
  const [greeting, ...text] = paragraphs(email.body);
  const notes = paragraphs(email.footer);
  const last = notes.pop();
  return (
    <article
      aria-labelledby="subject"
      className="min-w-0 flex-[999_1_560px] rounded-3xl bg-card p-2"
    >
      <div className="flex flex-col rounded-[18px] border border-border bg-background">
        <header className="flex flex-col gap-2.5 border-b border-border px-6 py-5">
          <h2
            id="subject"
            className="text-xl font-semibold tracking-[-0.015em]"
          >
            {email.subject}
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px] leading-5">
            <dt className="text-muted-foreground">From</dt>
            <dd>
              Joinpath for {orgName}{' '}
              <span className="text-muted-foreground">
                &lt;no-reply@joinpath.demo&gt;
              </span>
            </dd>
            <dt className="text-muted-foreground">To</dt>
            <dd className="font-mono text-xs leading-5">{email.toEmail}</dd>
            <dt className="text-muted-foreground">Sent</dt>
            <dd>{formatMomentIn(email.sentAt, timeZone)}</dd>
          </dl>
        </header>
        <div className="flex justify-center px-6 pt-10 pb-12">
          <div className="flex w-full max-w-130 flex-col gap-5 text-[15px] leading-[25px]">
            <span className="flex items-center gap-2.5">
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-white">
                <Route size={16} aria-hidden />
              </span>
              <span className="font-semibold">{orgName}</span>
            </span>
            <p className="text-[22px] leading-[30px] font-semibold tracking-[-0.015em]">
              {greeting}
            </p>
            {text.map((paragraph) => (
              <p key={paragraph} className="text-foreground/80">
                {paragraph}
              </p>
            ))}
            <ButtonLink
              href={email.link}
              size="lg"
              className="self-start bg-primary-strong hover:bg-primary-strong/90"
            >
              {email.linkLabel}
            </ButtonLink>
            {notes.map((note) => (
              <p
                key={note}
                className="text-[13px] leading-[21px] text-muted-foreground"
              >
                {note}
              </p>
            ))}
            {last && (
              <>
                <div className="h-px bg-border" />
                <p className="text-xs leading-[19px] text-muted-foreground">
                  {last}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
