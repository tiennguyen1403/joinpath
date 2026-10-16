'use client';

import {
  type TaskDef,
  type TemplateDefinition,
  type TemplateIssue,
  type TemplateVersion,
  templateDefinitionSchema,
  templateVersionSchema,
  validateTemplate,
} from '@joinpath/core';
import { useQueryClient } from '@tanstack/react-query';
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Check, InfoCircle, Loader, XCircle } from 'reicon-react';
import { cn } from '@/components/beui/lib/utils';
import {
  AdaptiveStepper,
  AdaptiveStepperDecrement,
  AdaptiveStepperIncrement,
  AdaptiveStepperValue,
} from '@/components/beui/motion/adaptive-stepper';
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
} from '@/components/beui/motion/alert';
import { AnimatedBadge } from '@/components/beui/motion/animated-badge';
import { Input } from '@/components/beui/motion/input';
import {
  MultiSelect,
  MultiSelectContent,
  MultiSelectEmpty,
  MultiSelectInput,
  MultiSelectItem,
  MultiSelectList,
  MultiSelectTrigger,
  MultiSelectValue,
} from '@/components/beui/motion/multi-select';
import { RadioGroup, RadioGroupItem } from '@/components/beui/motion/radio';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/beui/motion/select';
import { EmptyState } from '@/components/empty-state';
import { TASK_TYPES } from '@/components/task-status';
import { api } from '@/lib/api';
import {
  ASSIGNEES,
  type AssigneeKey,
  assigneeKey,
  assigneeRule,
  Phases,
  signed,
  TaskSummary,
  titleOf,
} from './phases';

const list = new Intl.ListFormat('en-US');

// The panel field that fixes each rule's problem: its sentence goes under that field. BR-T04
// reaches a task here only as a title another task has, since the editor makes no broken link.
type Field = 'title' | 'reviews' | 'assignee' | 'due' | 'waitsFor';
const FIELD: Record<TemplateIssue['rule'], Field> = {
  'BR-T04': 'title',
  'BR-T05': 'waitsFor',
  'BR-T06': 'due',
  'BR-T07': 'due',
  'BR-T08': 'reviews',
  'BR-T09': 'waitsFor',
  'BR-T10': 'assignee',
};

const TYPE_HINTS: Record<TaskDef['type'], string> = {
  CHECKLIST: 'Someone marks it done',
  DOCUMENT: 'Files are uploaded',
  APPROVAL: 'Reviews a document',
};

// Rows hover on the list-row layer over their own white (ADR 009).
const ROW =
  'flex w-full items-center gap-3 rounded-2xl border border-border bg-background p-3 text-left outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--foreground)_5%,var(--background))] active:bg-[color-mix(in_srgb,var(--foreground)_8%,var(--background))] focus-visible:ring-2 focus-visible:ring-primary';
const TRIGGER = 'h-11 border-foreground/12';
const ERROR = { errorMessage: 'text-danger-strong' };
const MARKED =
  'bg-destructive/10 text-danger-strong ring-1 ring-destructive/30 ring-inset [&_button]:text-danger-strong';
const HINT = 'px-1 text-xs leading-4 text-muted-foreground';
// A white circle inset in the stepper's pill; gone where the stepper hides it at a limit.
const STEP =
  'border-4 bg-background hover:bg-[color-mix(in_srgb,var(--foreground)_5%,var(--background))] disabled:bg-transparent';

/** "day 3", or "4 days before day 1": the canvas counts from day 1, the start date. */
const dayOf = (offset: number) =>
  offset >= 0
    ? `day ${offset + 1}`
    : `${-offset} ${offset === -1 ? 'day' : 'days'} before day 1`;

/**
 * HR edits a draft's tasks (FR-04). core checks the whole definition after every change
 * (BR-T04–T10), and the draft saves itself a moment later, problems and all: they only stop
 * publishing (BR-T03).
 */
export function Editor({ version }: { version: TemplateVersion }) {
  const [definition, setDefinition] = useState(version.definition);
  const [selectedKey, setSelectedKey] = useState(definition.tasks[0]?.key);
  const { valid, issues } = useMemo(() => {
    // Checked as the API stores it, titles trimmed (BR-T04).
    const parsed = templateDefinitionSchema.safeParse(definition);
    return {
      valid: parsed.success,
      issues: validateTemplate(parsed.success ? parsed.data : definition),
    };
  }, [definition]);
  const save = useAutosave(version.id, definition, valid);

  const selected =
    definition.tasks.find(({ key }) => key === selectedKey) ??
    definition.tasks[0];
  if (!selected) {
    return (
      <EmptyState
        title="Nothing in this draft yet"
        description="Its phases and tasks show up here."
      />
    );
  }
  return (
    <>
      {issues.length > 0 && <Problems issues={issues} />}
      <div className="flex flex-wrap items-start gap-5">
        <div className="min-w-0 flex-[1_1_420px]">
          <Phases
            definition={definition}
            row={(task) => {
              const current = task === selected;
              const count = issues.filter(({ taskKeys }) =>
                taskKeys.includes(task.key),
              ).length;
              return (
                <button
                  type="button"
                  aria-current={current || undefined}
                  onClick={() => setSelectedKey(task.key)}
                  className={cn(
                    ROW,
                    current && 'border-primary ring-1 ring-primary',
                  )}
                >
                  <TaskSummary task={task} selected={current} />
                  {count > 0 && (
                    <AnimatedBadge
                      size="sm"
                      status="danger"
                      icon={<XCircle className="size-3" />}
                      className="shrink-0 text-danger-strong"
                    >
                      {count} {count === 1 ? 'problem' : 'problems'}
                    </AnimatedBadge>
                  )}
                </button>
              );
            }}
          />
        </div>
        <TaskPanel
          key={selected.key}
          task={selected}
          definition={definition}
          issues={issues}
          onChange={setDefinition}
          footer={
            <SaveLine
              state={save.state}
              draft={version.version}
              onRetry={save.retry}
            />
          }
        />
      </div>
    </>
  );
}

/** Every problem in one alert, as the Publish button will count them (M4.2). */
function Problems({ issues }: { issues: TemplateIssue[] }) {
  return (
    <Alert variant="destructive" className="text-danger-strong">
      <AlertIcon />
      <AlertContent>
        <AlertTitle>
          Fix {issues.length} {issues.length === 1 ? 'problem' : 'problems'} to
          publish
        </AlertTitle>
        <AlertDescription>
          {issues.length === 1 ? (
            issues[0].message
          ) : (
            <ul className="list-disc pl-4.5">
              {issues.map(({ message }, i) => (
                <li key={i}>{message}</li>
              ))}
            </ul>
          )}
        </AlertDescription>
      </AlertContent>
    </Alert>
  );
}

function TaskPanel({
  task,
  definition,
  issues,
  onChange,
  footer,
}: {
  task: TaskDef;
  definition: TemplateDefinition;
  issues: TemplateIssue[];
  onChange: Dispatch<SetStateAction<TemplateDefinition>>;
  footer: ReactNode;
}) {
  const id = useId();
  const { tasks, phases } = definition;
  const edit = (update: (task: TaskDef) => TaskDef) =>
    onChange((current) => ({
      ...current,
      tasks: current.tasks.map((t) => (t.key === task.key ? update(t) : t)),
    }));
  const byKey = (key: string | undefined) => tasks.find((t) => t.key === key);

  // This task's problems, each under the field that fixes it.
  const mine = issues.filter(({ taskKeys }) => taskKeys.includes(task.key));
  const sentences = (field: Field) =>
    mine
      .filter(({ rule }) => FIELD[rule] === field)
      .map(({ message }) => message);
  // Links that close a loop (BR-T05) or skip a review (BR-T09) are marked. A loop gets the
  // canvas's sentence from this task's side, unless it runs through what an approval reviews.
  const loop = mine.find(({ rule }) => rule === 'BR-T05');
  const looping = task.dependsOn.filter((key) => loop?.taskKeys.includes(key));
  const skipping = task.dependsOn.filter(
    (key) =>
      key !== task.reviews &&
      byKey(key)?.type === 'DOCUMENT' &&
      tasks.some((t) => t.type === 'APPROVAL' && t.reviews === key),
  );
  const marked = new Set([...looping, ...skipping]);
  const waitsForErrors = mine
    .filter(({ rule }) => FIELD[rule] === 'waitsFor')
    .map((issue) => {
      if (issue.rule !== 'BR-T05' || looping.length === 0) return issue.message;
      const titles = looping.map((key) => titleOf(byKey(key)!));
      return titles.length === 1
        ? `${titles[0]} already waits for this task, so this link makes a loop. Remove it.`
        : `${list.format(titles)} already wait for this task, so these links make a loop. Remove them.`;
    });

  const reviewed = task.type === 'APPROVAL' ? byKey(task.reviews) : undefined;
  const documents = tasks.filter(
    (t) => t.type === 'DOCUMENT' && t.key !== task.key,
  );
  // BR-R01 as a hint (PLAN §4.2): an approval and its document both with the direct manager
  // land on one person, so every activation has to hand the review to someone else.
  const partner =
    task.type === 'APPROVAL'
      ? reviewed?.type === 'DOCUMENT'
        ? reviewed
        : undefined
      : task.type === 'DOCUMENT'
        ? tasks.find((t) => t.type === 'APPROVAL' && t.reviews === task.key)
        : undefined;
  const sameManager =
    partner &&
    task.assignee.kind === 'DIRECT_MANAGER' &&
    partner.assignee.kind === 'DIRECT_MANAGER';

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="flex min-w-0 flex-[999_1_480px] flex-col gap-6 rounded-2xl border border-border p-6"
    >
      <h2
        id={`${id}-heading`}
        className="text-[15px] leading-[21px] font-semibold"
      >
        Edit task
      </h2>
      <div className="flex flex-col gap-5">
        <Input
          label="Title"
          value={task.title}
          onChange={(title) => edit((t) => ({ ...t, title }))}
          maxLength={120}
          autoComplete="off"
          error={
            task.title.trim() ? sentences('title')[0] : 'Give the task a title.'
          }
          classNames={ERROR}
        />
        <fieldset>
          <legend className="mb-2 px-1 text-sm font-medium">Type</legend>
          <RadioGroup
            orientation="horizontal"
            value={task.type}
            onValueChange={(value) => {
              const type = value as TaskDef['type'];
              // Only an approval reviews a document (BR-T08).
              edit((t) => ({
                ...t,
                type,
                reviews: type === 'APPROVAL' ? t.reviews : undefined,
              }));
            }}
            className="gap-x-6 gap-y-3 px-1"
          >
            {(Object.keys(TASK_TYPES) as TaskDef['type'][]).map((type) => (
              <RadioGroupItem
                key={type}
                value={type}
                label={TASK_TYPES[type].label}
                description={TYPE_HINTS[type]}
              />
            ))}
          </RadioGroup>
        </fieldset>
        {task.type === 'APPROVAL' && (
          <Field label="Document it reviews" errors={sentences('reviews')}>
            <Select
              value={task.reviews ?? ''}
              onValueChange={(reviews) => edit((t) => ({ ...t, reviews }))}
              disabled={documents.length === 0}
            >
              <SelectTrigger
                className={cn(
                  TRIGGER,
                  sentences('reviews').length > 0 && 'border-destructive',
                )}
              >
                {reviewed ? (
                  titleOf(reviewed)
                ) : (
                  <span className="text-muted-foreground">
                    {documents.length > 0
                      ? 'Pick a document'
                      : 'No document to review yet'}
                  </span>
                )}
              </SelectTrigger>
              <SelectContent>
                {documents.map((doc) => (
                  <SelectItem key={doc.key} value={doc.key}>
                    {titleOf(doc)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] items-start gap-4">
          <Field
            label="Who does it"
            errors={sentences('assignee')}
            hint={
              sameManager && (
                <p className={cn(HINT, 'flex gap-1.5')}>
                  <InfoCircle aria-hidden className="mt-px size-3.5 shrink-0" />
                  <span>
                    {titleOf(partner)} also goes to the direct manager, who
                    can&apos;t review their own upload. Each activation will ask
                    you to pick someone else for the review.
                  </span>
                </p>
              )
            }
          >
            <Select
              value={assigneeKey(task.assignee)}
              onValueChange={(key) =>
                edit((t) => ({
                  ...t,
                  assignee: assigneeRule(key as AssigneeKey),
                }))
              }
            >
              <SelectTrigger
                className={cn(
                  TRIGGER,
                  sentences('assignee').length > 0 && 'border-destructive',
                )}
              >
                {ASSIGNEES[assigneeKey(task.assignee)]}
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ASSIGNEES) as AssigneeKey[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {ASSIGNEES[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Phase">
            <Select
              value={task.phase}
              onValueChange={(phase) =>
                phase !== task.phase &&
                onChange((current) => {
                  const moving = current.tasks.find((t) => t.key === task.key)!;
                  // Last in its new phase: a phase lists its tasks in the list's order.
                  return {
                    ...current,
                    tasks: [
                      ...current.tasks.filter((t) => t !== moving),
                      { ...moving, phase },
                    ],
                  };
                })
              }
            >
              <SelectTrigger className={TRIGGER}>
                {phases.find(({ key }) => key === task.phase)?.name}
              </SelectTrigger>
              <SelectContent>
                {phases.map(({ key, name }) => (
                  <SelectItem key={key} value={key}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(216px,1fr))] items-start gap-4">
          <Offset
            label="Opens"
            value={task.availableOffsetDays}
            onValue={(availableOffsetDays) =>
              edit((t) => ({ ...t, availableOffsetDays }))
            }
            hint={`Days from the start date · ${dayOf(task.availableOffsetDays)}`}
            earlier="Open one day earlier"
            later="Open one day later"
          />
          <Offset
            label="Due"
            value={task.dueOffsetDays}
            onValue={(dueOffsetDays) => edit((t) => ({ ...t, dueOffsetDays }))}
            hint={
              task.dueOffsetDays >= 0
                ? `End of ${dayOf(task.dueOffsetDays)}`
                : `End of the day, ${dayOf(task.dueOffsetDays)}`
            }
            earlier="Due one day earlier"
            later="Due one day later"
            errors={sentences('due')}
          />
        </div>
        <Field
          label="Waits for"
          errors={waitsForErrors}
          hint={
            reviewed && (
              <p className={HINT}>
                Also waits for {titleOf(reviewed)}, the document it reviews.
              </p>
            )
          }
        >
          {/* Its own layer, so a select opened above it paints over it. */}
          <div className="relative z-0">
            <MultiSelect
              value={task.dependsOn}
              onValueChange={(dependsOn) => edit((t) => ({ ...t, dependsOn }))}
            >
              <MultiSelectTrigger>
                <MultiSelectValue
                  placeholder={null}
                  chipClassName={(key) =>
                    marked.has(key) ? MARKED : undefined
                  }
                />
                <MultiSelectInput
                  aria-label="Add a task this one waits for"
                  placeholder="Add a task…"
                />
              </MultiSelectTrigger>
              <MultiSelectContent>
                <MultiSelectList ariaLabel="Tasks">
                  {tasks
                    .filter((t) => t.key !== task.key)
                    .map((t) => (
                      <MultiSelectItem
                        key={t.key}
                        value={t.key}
                        textValue={titleOf(t)}
                      >
                        {titleOf(t)}
                      </MultiSelectItem>
                    ))}
                  <MultiSelectEmpty>No task by that name</MultiSelectEmpty>
                </MultiSelectList>
              </MultiSelectContent>
            </MultiSelect>
          </div>
        </Field>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-steps`} className="px-1 text-sm font-medium">
            Instructions
          </label>
          <textarea
            id={`${id}-steps`}
            rows={3}
            maxLength={2000}
            value={task.description ?? ''}
            onChange={(event) =>
              edit((t) => ({ ...t, description: event.target.value }))
            }
            aria-describedby={`${id}-steps-hint`}
            className="resize-y rounded-2xl border border-border bg-transparent px-4 py-2.5 text-sm leading-[22px] outline-none transition-colors focus:border-foreground/40 focus:ring-2 focus:ring-ring/40"
          />
          <p id={`${id}-steps-hint`} className={HINT}>
            One step per line. Each one shows as a numbered step.
          </p>
        </div>
      </div>
      {footer}
    </section>
  );
}

function Field({
  label,
  errors = [],
  hint,
  children,
}: {
  label: string;
  errors?: string[];
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="px-1 text-sm font-medium">{label}</span>
      {children}
      {hint}
      {errors.map((error, i) => (
        <p key={i} className="px-1 text-xs text-danger-strong">
          {error}
        </p>
      ))}
    </div>
  );
}

/** Days from the start date, on beUI's stepper (PLAN §10.1); the schema allows ±365. */
function Offset({
  label,
  value,
  onValue,
  hint,
  earlier,
  later,
  errors,
}: {
  label: string;
  value: number;
  onValue: (value: number) => void;
  hint: string;
  earlier: string;
  later: string;
  errors?: string[];
}) {
  return (
    <Field label={label} errors={errors} hint={<p className={HINT}>{hint}</p>}>
      {/* The canvas's grey pill holding two white buttons, so the liquid stays clear. Not a
          flex item: there Chrome gives the stepper's fieldset no height for its liquid. */}
      <div className="w-fit rounded-full bg-card">
        <AdaptiveStepper
          value={value}
          onValueChange={onValue}
          min={-365}
          max={365}
          aria-label={label}
          formatValueText={() => hint}
          fill="transparent"
        >
          <AdaptiveStepperDecrement aria-label={earlier} className={STEP} />
          <AdaptiveStepperValue>{signed}</AdaptiveStepperValue>
          <AdaptiveStepperIncrement aria-label={later} className={STEP} />
        </AdaptiveStepper>
      </div>
    </Field>
  );
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'failed' }
  | { kind: 'invalid' };

/**
 * Saves the draft a moment after each change (PLAN §8: PUT the whole definition), one request
 * at a time: changes made meanwhile go in the next. A definition the schema refuses, a task
 * with no title, waits until it is fixed. Leaving the page sends what is still unsent.
 */
function useAutosave(
  versionId: string,
  definition: TemplateDefinition,
  valid: boolean,
) {
  const queryClient = useQueryClient();
  // What the API holds, as far as this page knows, and the last definition it refused.
  const [saved, setSaved] = useState<{
    definition: TemplateDefinition;
    at?: number;
  }>({ definition });
  const [failed, setFailed] = useState<TemplateDefinition | null>(null);
  const loaded = useRef(definition);
  const unsent = useRef<TemplateDefinition | null>(null);
  const sending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const send = useCallback(async () => {
    clearTimeout(timer.current);
    if (sending.current) return;
    sending.current = true;
    let body = unsent.current;
    try {
      while (body) {
        unsent.current = null;
        const version = await api(
          `/template-versions/${versionId}`,
          templateVersionSchema,
          { method: 'PUT', body },
        );
        // For the next visit; this page keeps what is being typed, untrimmed.
        queryClient.setQueryData(['template-version', versionId], version);
        setSaved({ definition: body, at: Date.now() });
        body = unsent.current;
      }
    } catch {
      unsent.current ??= body;
      setFailed(body);
    } finally {
      sending.current = false;
    }
  }, [queryClient, versionId]);

  useEffect(() => {
    if (definition === loaded.current) return;
    clearTimeout(timer.current);
    unsent.current = valid ? definition : null;
    if (valid) timer.current = setTimeout(() => void send(), 600);
  }, [definition, valid, send]);

  useEffect(() => {
    const leave = () => {
      const body = unsent.current;
      if (!body) return;
      unsent.current = null;
      // The page is going away: send it without waiting for the answer.
      void fetch(`/api/template-versions/${versionId}`, {
        method: 'PUT',
        keepalive: true,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    };
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      clearTimeout(timer.current);
      leave();
    };
  }, [versionId]);

  const state: SaveState = !valid
    ? { kind: 'invalid' }
    : definition === saved.definition
      ? saved.at
        ? { kind: 'saved', at: saved.at }
        : { kind: 'idle' }
      : definition === failed
        ? { kind: 'failed' }
        : { kind: 'saving' };
  return { state, retry: () => void send() };
}

function SaveLine({
  state,
  draft,
  onRetry,
}: {
  state: SaveState;
  draft: number;
  onRetry: () => void;
}) {
  const now = useNow(30_000);
  const line = 'flex items-center gap-2 text-[13px] text-muted-foreground';
  switch (state.kind) {
    case 'saving':
      return (
        <p className={line}>
          <Loader
            aria-hidden
            className="size-3.5 animate-spin motion-reduce:animate-none"
          />
          Saving…
        </p>
      );
    case 'failed':
      return (
        <p role="alert" className={cn(line, 'text-danger-strong')}>
          <XCircle aria-hidden className="size-3.5" />
          Couldn&apos;t save your last change.
          <button
            type="button"
            onClick={onRetry}
            className="rounded-sm font-medium text-primary-strong outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            Try again
          </button>
        </p>
      );
    case 'invalid':
      return (
        <p className={line}>
          <InfoCircle aria-hidden className="size-3.5" />
          Not saved yet: give the task a title first.
        </p>
      );
    default:
      return (
        <p className={line}>
          <Check aria-hidden className="size-3.5" />
          Saved to draft v{draft}
          {state.kind === 'saved' && ` · ${ago(state.at, now)}`}
        </p>
      );
  }
}

/** The clock, read again every `ms`. */
function useNow(ms: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/** "just now", "2 minutes ago", "1 hour ago": real time, as a save is. */
function ago(at: number, now: number) {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60)
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
}
