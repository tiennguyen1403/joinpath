'use client';

import {
  type Employee,
  employeeSchema,
  type IsoDate,
  type OnboardingDetail,
  onboardingDetailSchema,
  type OnboardingSummary,
  onboardingSummarySchema,
  type Role,
  type Template,
  templateSchema,
} from '@joinpath/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { Check } from 'reicon-react';
import { Avatar, tintOf } from '@/components/avatar';
import { cn } from '@/components/beui/lib/utils';
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
} from '@/components/beui/motion/alert';
import { AnimatedBadge } from '@/components/beui/motion/animated-badge';
import { Button } from '@/components/beui/motion/button/base';
import {
  DateRangePicker,
  DateRangePickerCalendar,
  DateRangePickerGrid,
  DateRangePickerHeader,
} from '@/components/beui/motion/date-range-picker';
import { RadioGroup, RadioGroupItem } from '@/components/beui/motion/radio';
import { Table, Td, Th, THead, Tr } from '@/components/table';
import { api, ApiError } from '@/lib/api';
import {
  formatDate,
  formatDateIn,
  formatDateLong,
  formatFromToday,
} from '@/lib/format';
import { usePageCrumb } from '../app-shell';
import { Review } from './review';

export type Step = 1 | 2 | 3;

// White text sits on primary-strong (ADR 009).
export const PRIMARY = 'bg-primary-strong hover:bg-primary-strong/90';

/**
 * New onboarding (PLAN §10): the new hire, then template and start date, then what
 * activation creates. Step 2 saves the draft, so a draft's page opens on step 3, and
 * going back to step 1 or 2 edits the draft.
 */
export function Wizard({
  orgName,
  today,
  timeZone,
  draft,
  onActivated,
}: {
  orgName: string;
  today: IsoDate;
  timeZone: string;
  draft?: OnboardingDetail;
  onActivated?: (onboarding: OnboardingDetail) => void;
}) {
  usePageCrumb('New onboarding');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>(draft ? 3 : 1);
  const [employeeId, setEmployeeId] = useState(draft?.employee.id);
  const [templateId, setTemplateId] = useState(draft?.template.id);
  const [startDate, setStartDate] = useState(draft?.startDate);

  const employees = useQuery({
    queryKey: ['employees'],
    queryFn: () => api('/employees', employeeSchema.array()),
    enabled: step < 3,
  });
  const onboardings = useQuery({
    queryKey: ['onboardings'],
    queryFn: () => api('/onboardings', onboardingSummarySchema.array()),
    enabled: step === 1,
  });
  const templates = useQuery({
    queryKey: ['templates'],
    queryFn: () => api('/templates', templateSchema.array()),
    enabled: step === 2,
  });

  const save = useMutation({
    mutationFn: () => {
      const body = { employeeId, templateId, startDate };
      return draft
        ? api(`/onboardings/${draft.id}`, onboardingDetailSchema, {
            method: 'PATCH',
            body,
          })
        : api('/onboardings', onboardingDetailSchema, { method: 'POST', body });
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(['onboarding', saved.id], saved);
      void queryClient.invalidateQueries({ queryKey: ['onboardings'] });
      if (draft) {
        queryClient.removeQueries({ queryKey: ['preview', saved.id] });
        setStep(3);
      } else {
        router.replace(`/onboardings/${saved.id}`);
      }
    },
  });

  if (step === 3 && draft) {
    return (
      <Review
        draft={draft}
        onBack={setStep}
        onActivated={(onboarding) => onActivated?.(onboarding)}
      />
    );
  }

  const employee = employees.data?.find(({ id }) => id === employeeId);
  const template = templates.data?.find(({ id }) => id === templateId);
  const loadError = employees.error ?? onboardings.error ?? templates.error;

  return step === 1 ? (
    <WizardFrame
      step={1}
      onBack={setStep}
      title="Choose the new hire"
      description="The onboarding starts as a draft. Nothing is sent until you activate."
      aside={
        <>
          {employee ? (
            <NewHire employee={employee} role={employee.user?.role} />
          ) : (
            <p className="text-[13px] leading-5 text-muted-foreground">
              Pick someone to see their details here.
            </p>
          )}
          <Divider />
          <Button
            size="lg"
            className={PRIMARY}
            disabled={!employee}
            onClick={() => setStep(2)}
          >
            Continue
          </Button>
        </>
      }
    >
      {loadError && <LoadError what="the people" />}
      {employees.data && onboardings.data && (
        <People
          orgName={orgName}
          employees={employees.data}
          onboardings={onboardings.data}
          draftId={draft?.id}
          value={employeeId}
          onChange={setEmployeeId}
          today={today}
          timeZone={timeZone}
        />
      )}
    </WizardFrame>
  ) : (
    <WizardFrame
      step={2}
      onBack={setStep}
      title="Pick a template and start date"
      description="Task dates count from the start date, in calendar days."
      aside={
        <>
          {employee && (
            <NewHire
              employee={employee}
              role={employee.user?.role}
              template={
                template && { name: template.name, version: newest(template) }
              }
              startDate={startDate}
              today={today}
            />
          )}
          <Divider />
          {save.error && (
            <Alert
              variant="destructive"
              className="bg-destructive/7 text-danger-strong"
            >
              <AlertIcon />
              <AlertContent>
                <AlertTitle>Couldn&apos;t save the draft</AlertTitle>
                <AlertDescription className="text-muted-foreground">
                  {save.error instanceof ApiError
                    ? save.error.message
                    : 'Check your connection and try again.'}
                </AlertDescription>
              </AlertContent>
            </Alert>
          )}
          <div className="flex flex-col gap-2">
            <Button
              size="lg"
              className={PRIMARY}
              disabled={!template || !startDate || save.isPending}
              onClick={() => save.mutate()}
            >
              Continue
            </Button>
            <Button variant="secondary" onClick={() => setStep(1)}>
              Back
            </Button>
            <p className="text-center text-xs leading-4 text-muted-foreground">
              {draft
                ? 'Continue saves your changes to the draft.'
                : 'Continue saves a draft you can come back to.'}
            </p>
          </div>
        </>
      }
    >
      {loadError && <LoadError what="the templates" />}
      {templates.data && (
        <TemplateAndDate
          templates={templates.data}
          templateId={templateId}
          onTemplate={setTemplateId}
          startDate={startDate}
          onStartDate={setStartDate}
          today={today}
        />
      )}
    </WizardFrame>
  );
}

// The canvas's wizard frame: heading and steps, then the step beside its summary.
export function WizardFrame({
  step,
  onBack,
  title,
  description,
  aside,
  wide = false,
  children,
}: {
  step: Step;
  onBack: (step: Step) => void;
  title: string;
  description: string;
  aside: ReactNode;
  // Step 3's tables need the room: the summary moves below them sooner.
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="leading-[23px] text-muted-foreground">{description}</p>
        </div>
        <Steps step={step} onBack={onBack} />
      </div>
      <div className="flex flex-wrap items-start gap-6">
        <div
          className={cn(
            'flex min-w-0 flex-col gap-6',
            wide ? 'flex-[999_1_740px]' : 'flex-[999_1_600px]',
          )}
        >
          {children}
        </div>
        <aside
          aria-label="Summary"
          className="min-w-0 flex-[1_1_320px] rounded-3xl bg-card p-2"
        >
          <div className="flex flex-col gap-4.5 rounded-[18px] border border-border bg-background p-5">
            {aside}
          </div>
        </aside>
      </div>
    </>
  );
}

const STEPS = ['New hire', 'Template and date', 'Review and assign'];

// Done steps go back; the ones ahead wait for Continue.
function Steps({ step, onBack }: { step: Step; onBack: (step: Step) => void }) {
  return (
    <ol
      aria-label="Steps"
      className="flex flex-wrap gap-1 rounded-full bg-card p-1"
    >
      {STEPS.map((label, index) => {
        const n = (index + 1) as Step;
        if (n < step) {
          return (
            <li key={label}>
              <button
                type="button"
                onClick={() => onBack(n)}
                className="flex h-8 items-center gap-2 rounded-full px-3 text-[13px] font-medium text-muted-foreground outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary active:bg-foreground/8"
              >
                <Check aria-hidden className="size-3.5 text-success-strong" />
                {label}
                <span className="sr-only">(done, edit)</span>
              </button>
            </li>
          );
        }
        return (
          <li
            key={label}
            aria-current={n === step ? 'step' : undefined}
            className={cn(
              'flex h-8 items-center gap-2 rounded-full px-3 text-[13px] font-medium',
              n === step
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'font-mono text-xs',
                n === step && 'text-primary-strong',
              )}
            >
              {n}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

export const Divider = () => <div className="h-px bg-border" />;

function LoadError({ what }: { what: string }) {
  return (
    <Alert
      variant="destructive"
      className="bg-destructive/7 text-danger-strong"
    >
      <AlertIcon />
      <AlertContent>
        <AlertTitle>Couldn&apos;t load {what}</AlertTitle>
        <AlertDescription className="text-muted-foreground">
          Reload the page to try again.
        </AlertDescription>
      </AlertContent>
    </Alert>
  );
}

/** The summary's new hire, with what the steps so far chose. */
export function NewHire({
  employee,
  role,
  template,
  startDate,
  today,
}: {
  employee: Pick<
    Employee,
    'id' | 'fullName' | 'email' | 'jobTitle' | 'department' | 'manager'
  >;
  role: Role | undefined;
  template?: { name: string; version: number };
  startDate?: IsoDate;
  today?: IsoDate;
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        <Avatar
          name={employee.fullName}
          className={cn('size-10 text-sm', tintOf(employee.id, role))}
        />
        <span className="flex min-w-0 flex-col">
          <span className="text-[15px] font-semibold">{employee.fullName}</span>
          <span className="text-[13px] leading-[18px] text-muted-foreground">
            {[employee.jobTitle, employee.department?.name]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-[13px] leading-5">
        <dt className="text-muted-foreground">Email</dt>
        <dd className="font-mono text-xs [overflow-wrap:anywhere]">
          {employee.email}
        </dd>
        <dt className="text-muted-foreground">Manager</dt>
        <dd>{employee.manager?.fullName ?? '—'}</dd>
        {template && (
          <>
            <dt className="text-muted-foreground">Template</dt>
            <dd>
              {template.name}{' '}
              <span className="text-muted-foreground">v{template.version}</span>
            </dd>
          </>
        )}
        {startDate && today && (
          <>
            <dt className="text-muted-foreground">Starts</dt>
            <dd>
              <span className="font-mono text-xs">
                {formatDateLong(startDate)}
              </span>{' '}
              <span className="text-muted-foreground">
                · {formatFromToday(today, startDate)}
              </span>
            </dd>
          </>
        )}
      </dl>
    </>
  );
}

// Templates come newest version first; activation uses the newest published (BR-A03).
const newest = (template: Template) =>
  template.versions.find(({ status }) => status === 'PUBLISHED')?.version ?? 0;

// Step 1. Everyone is listed: a new hire may already have an account (PLAN §4.7). Someone
// with a draft or active onboarding can't start another (BR-A01).
function People({
  orgName,
  employees,
  onboardings,
  draftId,
  value,
  onChange,
  today,
  timeZone,
}: {
  orgName: string;
  employees: Employee[];
  onboardings: OnboardingSummary[];
  draftId: string | undefined;
  value: string | undefined;
  onChange: (employeeId: string) => void;
  today: IsoDate;
  timeZone: string;
}) {
  return (
    <section aria-labelledby="people" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 id="people" className="text-[15px] leading-[21px] font-semibold">
          People at {orgName}
        </h2>
        <span className="text-[13px] text-muted-foreground">
          {employees.length} {employees.length === 1 ? 'person' : 'people'}
        </span>
      </div>
      <RadioGroup value={value} onValueChange={onChange} className="block">
        <Table aria-labelledby="people" className="min-w-170">
          <THead>
            <Th className="w-9 pr-0">
              <span className="sr-only">Pick</span>
            </Th>
            <Th>Person</Th>
            <Th>Department</Th>
            <Th>Manager</Th>
            <Th>Onboarding</Th>
          </THead>
          <tbody>
            {employees.map((employee) => {
              // This draft's own new hire stays free to pick.
              const theirs = onboardings.filter(
                (onboarding) =>
                  onboarding.employee.id === employee.id &&
                  onboarding.id !== draftId,
              );
              const open = theirs.find(
                ({ status }) => status === 'DRAFT' || status === 'ACTIVE',
              );
              return (
                <Person
                  key={employee.id}
                  employee={employee}
                  open={open}
                  completed={theirs.find(
                    ({ status }) => status === 'COMPLETED',
                  )}
                  selected={employee.id === value}
                  today={today}
                  timeZone={timeZone}
                />
              );
            })}
          </tbody>
        </Table>
      </RadioGroup>
    </section>
  );
}

function Person({
  employee,
  open,
  completed,
  selected,
  today,
  timeZone,
}: {
  employee: Employee;
  open: OnboardingSummary | undefined;
  completed: OnboardingSummary | undefined;
  selected: boolean;
  today: IsoDate;
  timeZone: string;
}) {
  const radio = `hire-${employee.id}`;
  const none = <span className="text-muted-foreground">—</span>;
  return (
    // The name's label stretches over the row, so the whole row picks the person.
    <Tr
      className={cn(
        'relative',
        selected && 'bg-primary/5 hover:bg-primary/5',
        open && 'hover:bg-transparent',
      )}
    >
      <Td className="w-9 pr-0">
        <RadioGroupItem
          id={radio}
          value={employee.id}
          disabled={!!open}
          className={cn(
            open &&
              '[&>button]:border-foreground/10 [&>button]:bg-foreground/4',
          )}
        />
      </Td>
      <Td>
        <div className="flex items-center gap-3">
          <Avatar
            name={employee.fullName}
            className={cn('size-8', tintOf(employee.id, employee.user?.role))}
          />
          <span className="flex flex-col">
            <label
              htmlFor={radio}
              className={cn(
                'font-medium',
                !open && 'cursor-pointer after:absolute after:inset-0',
              )}
            >
              {employee.fullName}
            </label>
            <span className="text-[13px] leading-5 text-muted-foreground">
              {employee.jobTitle}
            </span>
          </span>
        </div>
      </Td>
      <Td className="whitespace-nowrap">{employee.department?.name ?? none}</Td>
      <Td className="whitespace-nowrap">
        {employee.manager?.fullName ?? none}
      </Td>
      <Td>
        {open ? (
          <span className="flex flex-wrap items-center gap-2">
            {open.status === 'ACTIVE' ? (
              <AnimatedBadge
                size="sm"
                status="info"
                showIcon={false}
                className="text-primary-strong"
              >
                Active
              </AnimatedBadge>
            ) : (
              <AnimatedBadge size="sm" status="neutral" showIcon={false}>
                Draft
              </AnimatedBadge>
            )}
            <span className="text-muted-foreground">
              {open.status === 'ACTIVE' && open.startDate <= today
                ? 'since'
                : 'starts'}{' '}
              {formatDate(open.startDate)}
            </span>
            <Link
              href={`/onboardings/${open.id}`}
              className="relative rounded-sm font-medium text-primary-strong outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {open.status === 'ACTIVE' ? 'View' : 'Continue draft'}
            </Link>
          </span>
        ) : completed?.completedAt ? (
          <span className="text-muted-foreground">
            Completed {formatDateIn(completed.completedAt, timeZone)}
          </span>
        ) : (
          none
        )}
      </Td>
    </Tr>
  );
}

// Step 2. Only templates that can start an onboarding: not archived, with a published
// version (BR-T12).
function TemplateAndDate({
  templates,
  templateId,
  onTemplate,
  startDate,
  onStartDate,
  today,
}: {
  templates: Template[];
  templateId: string | undefined;
  onTemplate: (templateId: string) => void;
  startDate: IsoDate | undefined;
  onStartDate: (startDate: IsoDate) => void;
  today: IsoDate;
}) {
  const usable = templates.filter(
    (template) => !template.archivedAt && newest(template) > 0,
  );
  return (
    <>
      <section aria-labelledby="template" className="flex flex-col gap-3">
        <h2
          id="template"
          className="px-1 text-[15px] leading-[21px] font-semibold"
        >
          Template
        </h2>
        {usable.length === 0 ? (
          <p className="px-1 text-muted-foreground">
            No template is published yet.
          </p>
        ) : (
          <RadioGroup
            value={templateId}
            onValueChange={onTemplate}
            className="gap-2"
          >
            {usable.map((template) => (
              <RadioGroupItem
                key={template.id}
                value={template.id}
                label={template.name}
                description={[`v${newest(template)}`, template.description]
                  .filter(Boolean)
                  .join(' · ')}
                className={cn(
                  'w-full rounded-2xl border p-4 transition-colors',
                  template.id === templateId
                    ? 'border-primary/50 bg-primary/4'
                    : 'border-border hover:bg-foreground/5',
                )}
              />
            ))}
          </RadioGroup>
        )}
      </section>
      <section aria-labelledby="start" className="flex flex-col gap-3">
        <h2
          id="start"
          className="px-1 text-[15px] leading-[21px] font-semibold"
        >
          Start date
        </h2>
        <div className="flex flex-wrap items-start gap-6">
          {/* A past date is allowed: the review warns about overdue tasks (BR-A06). */}
          <DateRangePicker
            single
            today={today}
            label="Start date"
            value={startDate ? { from: startDate, to: startDate } : null}
            onValueChange={(range) => range && onStartDate(range.from)}
          >
            <DateRangePickerCalendar>
              <DateRangePickerHeader />
              <DateRangePickerGrid />
            </DateRangePickerCalendar>
          </DateRangePicker>
          {startDate && (
            <div className="flex flex-col gap-0.5 pt-2">
              <span className="font-mono text-[15px] font-medium">
                {formatDateLong(startDate)}
              </span>
              <span className="text-muted-foreground">
                {formatFromToday(today, startDate)}
              </span>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
