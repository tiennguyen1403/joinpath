'use client';

import { type OnboardingDetail, onboardingDetailSchema } from '@joinpath/core';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Avatar, newHireTint } from '@/components/avatar';
import { cn } from '@/components/beui/lib/utils';
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
} from '@/components/beui/motion/alert';
import { AnimatedBadge } from '@/components/beui/motion/animated-badge';
import {
  AnimatedToastStack,
  useAnimatedToastStack,
} from '@/components/beui/motion/animated-toast-stack';
import { EmptyState } from '@/components/empty-state';
import { api, ApiError } from '@/lib/api';
import { formatDate, formatFromToday } from '@/lib/format';
import { usePageCrumb } from '../../app-shell';
import { STATUS_BADGE } from '../onboardings-table';
import { capitalized, inWords } from '../review';
import { Wizard } from '../wizard';

/**
 * An onboarding's page. A draft is still the wizard, at its review; once activated it is
 * the onboarding's header, which M1.7 follows with the tasks.
 */
export function OnboardingView({
  id,
  orgName,
  timeZone,
}: {
  id: string;
  orgName: string;
  timeZone: string;
}) {
  const { toasts, showToast, dismissToast } = useAnimatedToastStack();
  const { data, error } = useQuery({
    queryKey: ['onboarding', id],
    queryFn: () => api(`/onboardings/${id}`, onboardingDetailSchema),
  });
  usePageCrumb(
    data && data.status !== 'DRAFT' ? data.employee.fullName : undefined,
  );

  function activated(onboarding: OnboardingDetail) {
    const ready = onboarding.tasks.filter(
      ({ availability }) => availability === 'READY',
    ).length;
    // The canvas also says the invitation is on its way: from M2.1.
    showToast({
      status: 'success',
      title: 'Activated just now',
      description: `${onboarding.tasks.length} tasks were created. ${
        ready === 0
          ? 'They open on their dates.'
          : `${capitalized(inWords(ready))} ${ready === 1 ? 'task is' : 'tasks are'} open today.`
      }`,
    });
  }

  let page: ReactNode = null;
  if (data) {
    page =
      data.status === 'DRAFT' ? (
        <Wizard
          orgName={orgName}
          today={data.today}
          timeZone={timeZone}
          draft={data}
          onActivated={activated}
        />
      ) : (
        <Header onboarding={data} />
      );
  } else if (
    error instanceof ApiError &&
    (error.status === 404 || error.status === 400)
  ) {
    page = (
      <EmptyState
        title="Onboarding not found"
        description="It may not exist, or it isn't one you can see."
      />
    );
  } else if (error) {
    page = (
      <Alert variant="destructive" className="text-danger-strong">
        <AlertIcon />
        <AlertContent>
          <AlertTitle>Couldn&apos;t load the onboarding</AlertTitle>
          <AlertDescription>Reload the page to try again.</AlertDescription>
        </AlertContent>
      </Alert>
    );
  }

  return (
    <>
      {page}
      <AnimatedToastStack
        toasts={toasts}
        onDismiss={dismissToast}
        fixed
        classNames={{ iconWrap: 'bg-success/10 text-success-strong' }}
      />
    </>
  );
}

// The canvas's header; Change start date and Cancel come with M3.1, the tabs from M1.7.
function Header({ onboarding }: { onboarding: OnboardingDetail }) {
  const { employee, template, templateVersion, tasks, startDate, today } =
    onboarding;
  const done = tasks.filter(({ status }) => status === 'COMPLETED').length;
  const badge = STATUS_BADGE[onboarding.status];
  return (
    <>
      <div className="flex items-center gap-4">
        <Avatar
          name={employee.fullName}
          className={cn('size-14 text-lg', newHireTint(employee.id))}
        />
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-3xl font-semibold tracking-tight">
              {employee.fullName}
            </h1>
            <AnimatedBadge
              size="md"
              status={badge.status}
              showIcon={onboarding.status === 'COMPLETED'}
              className={badge.className}
            >
              {badge.label}
            </AnimatedBadge>
          </div>
          <span className="text-muted-foreground">
            {[
              employee.jobTitle,
              employee.department?.name,
              employee.manager && `reports to ${employee.manager.fullName}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3">
        <Stat label="Starts" note={formatFromToday(today, startDate)}>
          <span className="font-mono">{formatDate(startDate)}</span>
        </Stat>
        <Stat
          label="Template"
          note={`Version ${templateVersion.version}, locked in`}
        >
          {template.name}
        </Stat>
        <Stat
          label="Progress"
          bar={
            // The words above carry the value, as in the onboardings table.
            <div
              aria-hidden
              className="mt-1 h-1.5 overflow-hidden rounded-full bg-foreground/6"
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  width: `${(done / Math.max(tasks.length, 1)) * 100}%`,
                }}
              />
            </div>
          }
        >
          {done} of {tasks.length}{' '}
          <span className="text-[13px] font-normal text-muted-foreground">
            done
          </span>
        </Stat>
      </div>
    </>
  );
}

function Stat({
  label,
  note,
  bar,
  children,
}: {
  label: string;
  note?: string;
  bar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-card px-4.5 py-4">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="text-[15px] font-medium">{children}</span>
      {note && (
        <span className="text-[13px] text-muted-foreground">{note}</span>
      )}
      {bar}
    </div>
  );
}
