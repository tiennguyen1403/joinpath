'use client';

import {
  type OnboardingStatus,
  type OnboardingSummary,
  onboardingSummarySchema,
} from '@joinpath/core';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Clock, Plus } from 'reicon-react';
import { Avatar, newHireTint } from '@/components/avatar';
import { cn } from '@/components/beui/lib/utils';
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
} from '@/components/beui/motion/alert';
import {
  AnimatedBadge,
  type AnimatedBadgeStatus,
} from '@/components/beui/motion/animated-badge';
import { ButtonLink } from '@/components/beui/motion/button/base';
import { EmptyState } from '@/components/empty-state';
import { Table, Td, Th, THead, Tr } from '@/components/table';
import { api } from '@/lib/api';
import { formatDate, formatDateIn } from '@/lib/format';

export function NewOnboardingButton() {
  return (
    <ButtonLink
      href="/onboardings/new"
      className="bg-primary-strong hover:bg-primary-strong/90"
    >
      <Plus className="size-4" />
      New onboarding
    </ButtonLink>
  );
}

// Tinted as on the canvas. Small text on a tint takes the strong shade (ADR 009), and success
// takes the theme's hue rather than beUI's emerald.
export const STATUS_BADGE: Record<
  OnboardingStatus,
  { label: string; status: AnimatedBadgeStatus; className?: string }
> = {
  DRAFT: { label: 'Draft', status: 'neutral' },
  ACTIVE: { label: 'Active', status: 'info', className: 'text-primary-strong' },
  COMPLETED: {
    label: 'Completed',
    status: 'success',
    className: 'border-success/30 bg-success/10 text-success-strong',
  },
  CANCELED: { label: 'Canceled', status: 'neutral' },
};

const COLUMNS = [
  'New hire',
  'Starts',
  'Template',
  'Progress',
  'Status',
  'Next step',
];

/** The onboardings the signed-in person may see (PLAN §9), as the canvas's Dashboard lists them. */
export function OnboardingsTable({
  heading,
  timeZone,
  empty,
}: {
  // With a heading the table is a section of its page, and counts its people.
  heading?: string;
  // The org's, for the day an onboarding finished.
  timeZone: string;
  empty: { title: string; description: string };
}) {
  const { data, error } = useQuery({
    queryKey: ['onboardings'],
    queryFn: () => api('/onboardings', onboardingSummarySchema.array()),
  });
  // A failed refetch keeps the rows already shown.
  if (!data) {
    return error ? (
      <Alert variant="destructive" className="text-danger-strong">
        <AlertIcon />
        <AlertContent>
          <AlertTitle>Couldn&apos;t load the onboardings</AlertTitle>
          <AlertDescription>Reload the page to try again.</AlertDescription>
        </AlertContent>
      </Alert>
    ) : null;
  }
  if (data.length === 0) return <EmptyState {...empty} />;

  const table = (
    <Table className="min-w-205">
      <THead>
        {COLUMNS.map((column) => (
          <Th key={column}>{column}</Th>
        ))}
      </THead>
      <tbody>
        {data.map((onboarding) => (
          <Row
            key={onboarding.id}
            onboarding={onboarding}
            timeZone={timeZone}
          />
        ))}
      </tbody>
    </Table>
  );
  if (!heading) return table;
  return (
    <section aria-labelledby="onboardings" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3 px-1">
        <h2
          id="onboardings"
          className="text-[15px] leading-[21px] font-semibold"
        >
          {heading}
        </h2>
        <span className="text-[13px] text-muted-foreground">
          {data.length} {data.length === 1 ? 'person' : 'people'}
        </span>
      </div>
      {table}
    </section>
  );
}

function Row({
  onboarding,
  timeZone,
}: {
  onboarding: OnboardingSummary;
  timeZone: string;
}) {
  const { id, status, employee, template, templateVersion, progress } =
    onboarding;
  const href = `/onboardings/${id}`;
  const badge = STATUS_BADGE[status];
  return (
    // The name's link stretches over the row, so the whole row opens the onboarding.
    <Tr className="relative active:bg-foreground/8">
      <Td>
        <div className="flex items-center gap-3">
          <Avatar
            name={employee.fullName}
            className={cn('size-8', newHireTint(employee.id))}
          />
          <span className="flex flex-col">
            <Link
              href={href}
              className="font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-primary focus-visible:after:ring-inset"
            >
              {employee.fullName}
            </Link>
            <span className="text-[13px] leading-5 text-muted-foreground">
              {employee.jobTitle}
            </span>
          </span>
        </div>
      </Td>
      <Td className="font-mono text-[13px]">
        {formatDate(onboarding.startDate)}
      </Td>
      <Td>
        {template.name}{' '}
        <span className="text-muted-foreground">
          v{templateVersion.version}
        </span>
      </Td>
      <Td>
        {progress.total === 0 ? (
          <span className="text-muted-foreground">Not started</span>
        ) : (
          <div className="flex items-center gap-2.5">
            <div
              aria-hidden
              className="h-1.5 w-24 overflow-hidden rounded-full bg-foreground/6"
            >
              <div
                className={cn(
                  'h-full rounded-full',
                  status === 'COMPLETED' ? 'bg-success' : 'bg-primary',
                )}
                style={{
                  width: `${(progress.completed / progress.total) * 100}%`,
                }}
              />
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              {progress.completed}/{progress.total}
            </span>
          </div>
        )}
      </Td>
      <Td>
        {/* The badges are positioned, which would lift them over the row's link. */}
        <div className="pointer-events-none flex flex-wrap gap-1.5">
          <AnimatedBadge
            size="sm"
            status={badge.status}
            showIcon={status === 'COMPLETED'}
            className={badge.className}
          >
            {badge.label}
          </AnimatedBadge>
          {progress.overdue > 0 && (
            <AnimatedBadge
              size="sm"
              status="danger"
              icon={<Clock className="size-3" />}
              className="text-danger-strong"
            >
              {progress.overdue} overdue
            </AnimatedBadge>
          )}
        </div>
      </Td>
      <Td className="text-muted-foreground">
        {status === 'DRAFT' ? (
          // Above the row's link, though both open the same page.
          <Link
            href={href}
            className="relative rounded-sm font-medium text-primary-strong outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Review and activate
          </Link>
        ) : onboarding.canceledAt ? (
          `Canceled ${formatDateIn(onboarding.canceledAt, timeZone)}`
        ) : onboarding.completedAt ? (
          `Finished ${formatDateIn(onboarding.completedAt, timeZone)}`
        ) : (
          onboarding.nextTask?.title
        )}
      </Td>
    </Tr>
  );
}
