'use client';

import {
  type ActivityEvent,
  activityEventSchema,
  today as dayIn,
  type IsoDate,
} from '@joinpath/core';
import { useQuery } from '@tanstack/react-query';
import { Fragment } from 'react';
import { cn } from '@/components/beui/lib/utils';
import { api } from '@/lib/api';
import { formatDate, formatShortMomentIn, formatTimeIn } from '@/lib/format';

// A person's name, a task's title, or the words between them.
type Part = string | { name: string } | { task: string };

const LIST = new Intl.ListFormat('en-US');

/**
 * What happened, in words. On the dashboard a line names whose onboarding it was; on the
 * onboarding's own page that goes without saying.
 */
function partsOf(event: ActivityEvent, dashboard: boolean): Part[] {
  const hire = { name: event.onboarding.employee.fullName };
  const theirs = { name: `${hire.name}'s` };
  // Nothing on a timeline is the system's yet (PLAN §8).
  const actor = { name: event.actor?.fullName ?? 'Someone' };
  const task = { task: event.task?.title ?? '' };
  // Whose task it was, unless the new hire did it: then it is plainly theirs.
  const forHire: Part[] =
    dashboard && event.actor?.id !== event.onboarding.employee.id
      ? ['for', hire]
      : [];
  switch (event.action) {
    case 'onboarding.created':
      return dashboard
        ? [actor, 'created a draft onboarding for', hire]
        : [actor, 'created the draft'];
    case 'onboarding.activated':
      return dashboard
        ? [actor, 'activated', theirs, 'onboarding']
        : [actor, 'activated the onboarding'];
    case 'onboarding.rescheduled':
      return [
        actor,
        ...(dashboard
          ? ['moved', theirs, 'start date']
          : ['moved the start date']),
        `from ${formatDate(event.from)} to ${formatDate(event.to)}`,
      ];
    case 'onboarding.canceled':
      return dashboard
        ? [actor, 'canceled', theirs, 'onboarding']
        : [actor, 'canceled the onboarding'];
    // Whoever did the last task, which the line before says.
    case 'onboarding.completed':
      return [hire, 'finished onboarding'];
    case 'invitation.sent':
      return ['Invitation emailed to', hire];
    case 'invitation.resent':
      return dashboard
        ? [actor, 'emailed', theirs, 'invitation again']
        : [actor, 'emailed the invitation again'];
    case 'invitation.accepted':
      return [actor, 'accepted the invitation'];
    case 'task.started':
      return [actor, 'started', task, ...forHire];
    case 'task.completed':
      return [actor, 'completed', task, ...forHire];
    case 'task.reassigned':
      return [
        actor,
        'reassigned',
        task,
        ...forHire,
        `from ${event.from.fullName} to ${event.to.fullName}`,
      ];
    case 'task.due_changed':
      return [
        actor,
        'moved the due date of',
        task,
        ...forHire,
        `from ${formatDate(event.from)} to ${formatDate(event.to)}`,
      ];
    case 'task.due_reset':
      return [
        actor,
        'reset the due date of',
        task,
        ...forHire,
        `to the template's, ${formatDate(event.to)}`,
      ];
    // The task is the DOCUMENT submitted, or the APPROVAL that decided.
    case 'document.submitted':
      return [
        actor,
        `submitted revision ${event.revision} of`,
        task,
        ...forHire,
      ];
    case 'document.approved':
      return [
        actor,
        `approved revision ${event.revision} in`,
        task,
        ...forHire,
      ];
    case 'document.rejected':
      return [
        actor,
        `asked for changes to revision ${event.revision} in`,
        task,
        ...forHire,
      ];
  }
}

/** An event as one line: names stand out, and on the dashboard the words between them step back. */
export function EventText({
  event,
  dashboard = false,
}: {
  event: ActivityEvent;
  dashboard?: boolean;
}) {
  return partsOf(event, dashboard).map((part, i) => (
    <Fragment key={i}>
      {i > 0 && ' '}
      {typeof part === 'string' ? (
        dashboard ? (
          <span className="text-muted-foreground">{part}</span>
        ) : (
          part
        )
      ) : 'name' in part ? (
        <span className="font-medium">{part.name}</span>
      ) : (
        part.task
      )}
    </Fragment>
  ));
}

/**
 * "today, 09:41" on the org's business day, else "Oct 13, 17:05". An event's moment is a
 * business one too (BR-D05), so the two compare.
 */
export function formatEventTime(at: string, today: IsoDate, timeZone: string) {
  return dayIn(timeZone, 0, new Date(at)) === today
    ? `today, ${formatTimeIn(at, timeZone)}`
    : formatShortMomentIn(at, timeZone);
}

// The canvas's dots: the activation, the invitation, then how a document or the onboarding ended.
const DOT: Partial<Record<ActivityEvent['action'], string>> = {
  'onboarding.activated': 'bg-primary',
  'invitation.sent': 'bg-accent',
  'invitation.resent': 'bg-accent',
  'invitation.accepted': 'bg-accent',
  'document.approved': 'bg-success',
  'onboarding.completed': 'bg-success',
  'document.rejected': 'bg-warning',
  'onboarding.canceled': 'bg-destructive',
};

/** The line under an event: HR's picks on activation, the deadlines a new start date reset. */
function detailOf(event: ActivityEvent) {
  if (event.action === 'onboarding.activated' && event.picks.length > 0) {
    const byPerson = Map.groupBy(event.picks, ({ assignee }) => assignee.id);
    return `Picked ${[...byPerson.values()]
      .map(
        (picks) =>
          `${picks[0].assignee.fullName} for ${LIST.format(picks.map(({ task }) => task.title))}`,
      )
      .join('; ')}`;
  }
  if (event.action === 'onboarding.rescheduled' && event.dueReset.length > 0) {
    return `${event.dueReset.length === 1 ? 'Due date' : 'Due dates'} back to the template's: ${LIST.format(
      event.dueReset.map(({ task }) => task.title),
    )}`;
  }
  return null;
}

/**
 * An onboarding's timeline, newest first, beside its tasks (PLAN §10). Whoever sees the
 * onboarding sees it, a document's revisions only with its files (§9).
 */
export function ActivityCard({
  onboardingId,
  today,
  timeZone,
}: {
  onboardingId: string;
  today: IsoDate;
  timeZone: string;
}) {
  const { data, error } = useQuery({
    queryKey: ['activity', onboardingId],
    queryFn: () =>
      api(`/onboardings/${onboardingId}/activity`, activityEventSchema.array()),
  });
  return (
    <section
      aria-labelledby="activity"
      className="flex flex-col gap-3.5 rounded-2xl bg-card p-4.5"
    >
      <h2 id="activity" className="text-[15px] leading-[21px] font-semibold">
        Activity
      </h2>
      {data ? (
        <ol className="flex flex-col gap-3.5 text-sm">
          {data.map((event) => {
            const detail = detailOf(event);
            return (
              <li key={event.id} className="flex gap-3">
                <span
                  aria-hidden
                  className={cn(
                    'mt-1.5 size-2 shrink-0 rounded-full',
                    DOT[event.action] ?? 'bg-foreground/20',
                  )}
                />
                <span className="flex min-w-0 flex-col">
                  <span>
                    <EventText event={event} />
                  </span>
                  {detail && (
                    <span className="text-[13px] leading-5 text-muted-foreground">
                      {detail}
                    </span>
                  )}
                  <span className="text-xs leading-[18px] text-muted-foreground">
                    {[
                      ...(event.action === 'onboarding.activated'
                        ? [
                            `Version ${event.version}`,
                            `${event.taskCount} ${event.taskCount === 1 ? 'task' : 'tasks'}`,
                          ]
                        : []),
                      formatEventTime(event.at, today, timeZone),
                    ].join(' · ')}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        error && (
          <p className="text-[13px] leading-5 text-muted-foreground">
            Couldn&apos;t load the activity. Reload the page to try again.
          </p>
        )
      )}
    </section>
  );
}
