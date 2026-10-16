import { addDays, availability } from '@joinpath/core';
import type { PrismaService } from '../../prisma.js';
import { fromIsoDate, toIsoDate } from '../onboarding/onboarding.service.js';
import { orgToday } from '../org/org.service.js';
import { dueSoon, type Note, notify, opened, overdue } from './notify.js';

/**
 * The periodic work for one org, on its business date (PLAN §6.5): tasks whose date has come,
 * and due-soon and overdue reminders (BR-N03). The cron runs it for every org, the demo clock
 * for its own org at once (BR-D03). Run twice on a day, it adds nothing (BR-N04).
 */
export async function tickOrg(prisma: PrismaService, organizationId: string) {
  const today = await orgToday(prisma, organizationId);
  // Open tasks of running onboardings only (BR-C04): those whose date has come, and those
  // under way. Checking `<=` rather than `=`, the clock may skip days and miss none.
  const tasks = await prisma.task.findMany({
    where: {
      organizationId,
      onboarding: { status: 'ACTIVE' },
      OR: [
        { status: 'IN_PROGRESS' },
        { status: 'PENDING', availableOn: { lte: fromIsoDate(today) } },
      ],
    },
    orderBy: [{ dueOn: 'asc' }, { phaseOrder: 'asc' }, { position: 'asc' }],
    select: {
      id: true,
      title: true,
      type: true,
      status: true,
      assigneeEmployeeId: true,
      availableOn: true,
      dueOn: true,
      onboarding: {
        select: { employee: { select: { id: true, fullName: true } } },
      },
      dependsOn: { select: { dependsOn: { select: { status: true } } } },
      dependents: {
        orderBy: { task: { position: 'asc' } },
        select: { task: { select: { title: true, status: true } } },
      },
      reviews: { select: { _count: { select: { submissions: true } } } },
    },
  });
  const notes: Note[] = [];
  for (const row of tasks) {
    const task = {
      ...row,
      availableOn: toIsoDate(row.availableOn),
      dueOn: toIsoDate(row.dueOn),
    };
    // A blocked task's assignee can do nothing yet: the task it waits on gets the reminders.
    const now = availability(
      task,
      'ACTIVE',
      row.dependsOn.map((dep) => dep.dependsOn.status),
      today,
    );
    if (now !== 'READY') continue;
    const newHire = row.onboarding.employee;
    if (task.status === 'PENDING') {
      notes.push(
        opened(
          { ...task, revision: row.reviews?._count.submissions },
          newHire,
          'Its start date has come.',
        ),
      );
    }
    if (task.dueOn === addDays(today, 1)) notes.push(dueSoon(task, newHire));
    if (task.dueOn < today) {
      const waiting = row.dependents
        .map((dep) => dep.task)
        .filter(
          (each) => each.status === 'PENDING' || each.status === 'IN_PROGRESS',
        )
        .map((each) => each.title);
      notes.push(overdue(task, newHire, today, waiting));
    }
  }
  await prisma.$transaction((tx) => notify(tx, organizationId, notes));
}
