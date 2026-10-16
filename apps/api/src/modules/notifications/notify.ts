import {
  firstName,
  formatDate,
  formatDateInFull,
  inWords,
  type IsoDate,
  type NotificationKind,
} from '@joinpath/core';
import { env } from '../../env.js';
import type { Prisma } from '../../generated/prisma/client.js';

/** One notification for one person (BR-N02, BR-N03), with the email that goes with it, if any. */
export type Note = {
  // An employee id.
  to: string;
  kind: NotificationKind;
  taskId?: string;
  title: string;
  body: string;
  // The new hire works from their portal, everyone else from My tasks or an onboarding's page.
  link: string;
  // A reminder or a task's opening goes out once, whoever asks again (BR-N04).
  dedupeKey?: string;
  email?: { subject: string; paragraphs: string[]; reminder?: true };
};

// The button under an email, by where its link goes.
const BUTTON: Record<string, string> = {
  '/my-onboarding': 'Open your onboarding',
  '/tasks': 'Open My tasks',
};

/**
 * Writes the notes in the caller's transaction, so they stand or fall with the change
 * (BR-N01). Whoever acted hears nothing of it. A note whose key is used already is skipped,
 * and so is its email (BR-N04).
 */
export async function notify(
  tx: Prisma.TransactionClient,
  organizationId: string,
  notes: Note[],
  actorId?: string,
) {
  const kept = notes.filter((note) => note.to !== actorId);
  if (kept.length === 0) return;
  const created = await tx.notification.createManyAndReturn({
    data: kept.map((note) => ({
      organizationId,
      recipientEmployeeId: note.to,
      kind: note.kind,
      taskId: note.taskId,
      title: note.title,
      body: note.body,
      link: note.link,
      dedupeKey: note.dedupeKey,
    })),
    skipDuplicates: true,
    select: { dedupeKey: true },
  });
  const fresh = new Set(created.map((row) => row.dedupeKey));
  const mail = kept.flatMap(({ to, link, dedupeKey, email }) =>
    email && (!dedupeKey || fresh.has(dedupeKey)) ? [{ to, link, email }] : [],
  );
  if (mail.length === 0) return;
  // Only to someone who can sign in, as the link needs it: a new hire gets in through the
  // invitation first.
  const people = await tx.employee.findMany({
    where: {
      id: { in: mail.map((each) => each.to) },
      user: { status: 'ACTIVE' },
    },
    select: { id: true, fullName: true, email: true },
  });
  const { name } = await tx.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true },
  });
  await tx.mockEmail.createMany({
    data: mail.flatMap(({ to, link, email }) => {
      const person = people.find((each) => each.id === to);
      if (!person) return [];
      // Worded like the invitation's small print.
      const footer = [
        email.reminder && "You get one reminder a day until it's done.",
        link === '/my-onboarding'
          ? `You're receiving this because ${name} added you as a new hire in Joinpath.`
          : `You're receiving this because you have tasks in Joinpath at ${name}.`,
      ];
      return {
        organizationId,
        toEmail: person.email,
        toName: person.fullName,
        subject: email.subject,
        body: [`Hi ${firstName(person.fullName)},`, ...email.paragraphs].join(
          '\n\n',
        ),
        link: `${env.APP_ORIGIN}${link}`,
        linkLabel: BUTTON[link],
        footer: footer.filter(Boolean).join('\n\n'),
      };
    }),
  });
}

export type Person = { id: string; fullName: string };

export const personOf = (
  tx: Prisma.TransactionClient,
  employeeId: string,
): Promise<Person> =>
  tx.employee.findUniqueOrThrow({
    where: { id: employeeId },
    select: { id: true, fullName: true },
  });

export async function newHireOf(
  tx: Prisma.TransactionClient,
  onboardingId: string,
): Promise<Person> {
  const { employee } = await tx.onboarding.findUniqueOrThrow({
    where: { id: onboardingId },
    select: { employee: { select: { id: true, fullName: true } } },
  });
  return employee;
}

// What the notes say: the copy approved in M3.2a. Dates are business dates (PLAN §4.6).

type Task = {
  id: string;
  title: string;
  assigneeEmployeeId: string;
  availableOn: IsoDate;
  dueOn: IsoDate;
};

const linkFor = (to: string, newHire: Person) =>
  to === newHire.id ? '/my-onboarding' : '/tasks';

// "For An Vo, due Fri, Oct 23.": the new hire's own task needs no name.
const dueFor = (to: string, newHire: Person, dueOn: IsoDate) =>
  to === newHire.id
    ? `Due ${formatDate(dueOn)}.`
    : `For ${newHire.fullName}, due ${formatDate(dueOn)}.`;

// Each person's share of a list, in its order.
function byPerson<T>(items: T[], personOf: (item: T) => string) {
  const shares = new Map<string, T[]>();
  for (const item of items) {
    shares.set(personOf(item), [...(shares.get(personOf(item)) ?? []), item]);
  }
  return shares;
}

// "A opens Mon, Oct 19, and B opens Wed, Oct 21": the items carry commas of their own.
const series = (items: string[]) =>
  items.length < 2
    ? items.join('')
    : `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;

const LIST = new Intl.ListFormat('en-US');

/** On activation: each person's tasks, but the new hire's, whom the invitation tells. */
export function assigned(
  {
    newHire,
    actor,
    startDate,
    today,
  }: { newHire: Person; actor: string; startDate: IsoDate; today: IsoDate },
  tasks: Omit<Task, 'id'>[],
): Note[] {
  const others = tasks.filter((task) => task.assigneeEmployeeId !== newHire.id);
  return [...byPerson(others, (task) => task.assigneeEmployeeId)].map(
    ([to, theirs]) => {
      const title = `${theirs.length} ${theirs.length === 1 ? 'task' : 'tasks'} for ${newHire.fullName}'s onboarding`;
      const open = (task: Omit<Task, 'id'>) => task.availableOn <= today;
      return {
        to,
        kind: 'ASSIGNED',
        title,
        body: `${series(
          theirs.map((task) =>
            open(task)
              ? `${task.title} is open now`
              : `${task.title} opens ${formatDate(task.availableOn)}`,
          ),
        )}.`,
        link: '/tasks',
        email: {
          subject: title,
          paragraphs: [
            `${actor} set up ${newHire.fullName}'s onboarding. ${firstName(newHire.fullName)} starts on ${formatDateInFull(startDate)}, and ${theirs.length === 1 ? 'this one is' : `these ${inWords(theirs.length)} are`} yours:`,
            ...theirs.map((task) =>
              open(task)
                ? `${task.title} is open now and due ${formatDate(task.dueOn)}.`
                : `${task.title} opens ${formatDate(task.availableOn)} and is due ${formatDate(task.dueOn)}.`,
            ),
          ],
        },
      };
    },
  );
}

/** HR hands a task from one person to another (BR-S04). */
export function reassigned(
  { newHire, actor, today }: { newHire: Person; actor: string; today: IsoDate },
  task: Omit<Task, 'assigneeEmployeeId'>,
  from: Person,
  to: Person,
): Note[] {
  const when =
    task.availableOn <= today
      ? `It's open now and due ${formatDate(task.dueOn)}.`
      : `It opens ${formatDate(task.availableOn)} and is due ${formatDate(task.dueOn)}.`;
  return [
    {
      to: to.id,
      kind: 'ASSIGNED',
      taskId: task.id,
      title: `${task.title} is yours now`,
      body: `${actor} handed it to you from ${from.fullName}. ${dueFor(to.id, newHire, task.dueOn)}`,
      link: '/tasks',
      email: {
        subject: `${task.title} for ${newHire.fullName}'s onboarding`,
        paragraphs: [
          `${actor} handed you ${task.title} from ${from.fullName}. ${when}`,
        ],
      },
    },
    {
      to: from.id,
      kind: 'UNASSIGNED',
      taskId: task.id,
      title: `${task.title} went to ${to.fullName}`,
      body: `${actor} handed it on, so it's off your list.`,
      link: '/tasks',
    },
  ];
}

/**
 * A task that can start now (PLAN §4.4), and why: the prerequisite just done, the document
 * just sent, or its date. An approval opens again for each revision of its document.
 */
export function opened(
  task: Task & { type: string; revision?: number },
  newHire: Person,
  because: string,
  // `because` names the new hire already.
  named = false,
): Note {
  const to = task.assigneeEmployeeId;
  const approval = task.type === 'APPROVAL';
  return {
    to,
    kind: 'READY',
    taskId: task.id,
    title: `${task.title} is ${approval ? 'ready' : 'open'}`,
    body: `${because} ${named ? `Due ${formatDate(task.dueOn)}.` : dueFor(to, newHire, task.dueOn)}`,
    link: linkFor(to, newHire),
    dedupeKey: approval
      ? `ready:${task.id}:${task.revision}`
      : `ready:${task.id}`,
  };
}

/** The approver's decision on a revision, for whoever sent it (BR-R05, BR-R06). */
export function decided(
  document: Pick<Task, 'id' | 'title' | 'assigneeEmployeeId'>,
  newHire: Person,
  actor: string,
  revision: number,
  // Given when they ask for changes (BR-R04).
  reason?: string,
): Note {
  const to = document.assigneeEmployeeId;
  const note = { to, taskId: document.id, link: linkFor(to, newHire) };
  if (reason === undefined) {
    return {
      ...note,
      kind: 'APPROVED',
      title: `${firstName(actor)} approved your documents`,
      body: `${document.title} is done: revision ${revision} is approved.`,
    };
  }
  return {
    ...note,
    kind: 'REJECTED',
    title: `${firstName(actor)} asked for changes`,
    body: `“${reason}” Fix ${document.title} and send revision ${revision + 1}.`,
    email: {
      subject: `Changes needed: ${document.title}`,
      paragraphs: [
        `${actor} reviewed revision ${revision} and asked for changes:`,
        `“${reason}”`,
        `Upload what's needed, then send revision ${revision + 1}.`,
      ],
    },
  };
}

/** HR set a deadline, or put the template's back (BR-S03). */
export function dueChanged(
  task: Pick<Task, 'id' | 'title' | 'assigneeEmployeeId'>,
  newHire: Person,
  actor: string,
  dueOn: IsoDate,
  reset: boolean,
): Note {
  const to = task.assigneeEmployeeId;
  return {
    to,
    kind: 'DUE_CHANGED',
    taskId: task.id,
    title: `New due date for ${task.title}`,
    body: reset
      ? `${actor} set it back to the template's date, ${formatDate(dueOn)}.`
      : `${actor} moved it to ${formatDate(dueOn)}.`,
    link: linkFor(to, newHire),
  };
}

/** A new start date, for everyone whose open tasks moved with it (BR-S01). */
export function rescheduled(
  newHire: Person,
  startDate: IsoDate,
  moved: Pick<Task, 'assigneeEmployeeId'>[],
): Note[] {
  return [...byPerson(moved, (task) => task.assigneeEmployeeId)].map(
    ([to, theirs]) => {
      const one = theirs.length === 1;
      const own = to === newHire.id;
      return {
        to,
        kind: 'RESCHEDULED',
        title: own
          ? `Your start date is now ${formatDate(startDate)}`
          : `${newHire.fullName} now starts ${formatDate(startDate)}`,
        body: own
          ? `Your ${one ? 'open task' : `${theirs.length} open tasks`} moved with it.`
          : `Your ${one ? 'task' : `${theirs.length} tasks`} for ${firstName(newHire.fullName)}'s onboarding moved with it.`,
        link: linkFor(to, newHire),
      };
    },
  );
}

/** The last task done (BR-C01): for HR and the new hire's manager. */
export function completed(
  onboardingId: string,
  newHire: Person,
  people: string[],
  tasks: number,
): Note[] {
  return people.map((to) => ({
    to,
    kind: 'COMPLETED',
    title: `${newHire.fullName} finished onboarding`,
    body:
      tasks === 1 ? 'Its only task is done.' : `All ${tasks} tasks are done.`,
    link: `/onboardings/${onboardingId}`,
  }));
}

/**
 * HR called it off (BR-C03): for whoever had open tasks in it, but the new hire, whose account
 * it locks. The reason is HR's alone.
 */
export function canceled(
  onboardingId: string,
  newHire: Person,
  canceledTasks: Pick<Task, 'assigneeEmployeeId'>[],
): Note[] {
  const others = canceledTasks.filter(
    (task) => task.assigneeEmployeeId !== newHire.id,
  );
  return [...byPerson(others, (task) => task.assigneeEmployeeId)].map(
    ([to, theirs]) => ({
      to,
      kind: 'CANCELED',
      title: `${newHire.fullName}'s onboarding was canceled`,
      body:
        theirs.length === 1
          ? 'Your open task for it was canceled.'
          : `Your ${theirs.length} open tasks for it were canceled.`,
      link: `/onboardings/${onboardingId}`,
    }),
  );
}

/** Due tomorrow (BR-N03): once per task and due date. */
export function dueSoon(task: Task, newHire: Person): Note {
  const to = task.assigneeEmployeeId;
  return {
    to,
    kind: 'DUE_SOON',
    taskId: task.id,
    title: `${task.title} is due tomorrow`,
    body: dueFor(to, newHire, task.dueOn),
    link: linkFor(to, newHire),
    dedupeKey: `due-soon:${task.id}:${task.dueOn}`,
  };
}

/** Past due (BR-N03): once a day, by email too, naming what waits on it. */
export function overdue(
  task: Task,
  newHire: Person,
  today: IsoDate,
  waiting: string[],
): Note {
  const to = task.assigneeEmployeeId;
  const own = to === newHire.id;
  const title = own
    ? `Overdue: ${task.title}`
    : `Overdue: ${task.title} for ${newHire.fullName}`;
  const waits =
    waiting.length > 0
      ? ` ${LIST.format(waiting)} ${waiting.length === 1 ? 'is' : 'are'} waiting on it.`
      : '';
  return {
    to,
    kind: 'OVERDUE',
    taskId: task.id,
    title,
    body: `It was due ${formatDate(task.dueOn)}.${waits}`,
    link: linkFor(to, newHire),
    dedupeKey: `overdue:${task.id}:${today}`,
    email: {
      subject: title,
      paragraphs: [
        `${own ? task.title : `${task.title} for ${newHire.fullName}`} was due ${formatDate(task.dueOn)}.${waits}`,
      ],
      reminder: true,
    },
  };
}
