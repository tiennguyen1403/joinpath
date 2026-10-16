'use client';

import {
  keyFor,
  MAX_PHASES,
  MAX_TASKS,
  type TaskDef,
  type TemplateDefinition,
  type TemplateIssue,
  type TemplateVersion,
  templateDefinitionSchema,
  templateVersionSchema,
  validateTemplate,
  withoutTasks,
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
  useSyncExternalStore,
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Edit2,
  InfoCircle,
  Loader,
  More,
  Plus,
  Trash3,
  X,
  XCircle,
} from 'reicon-react';
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
import { Button } from '@/components/beui/motion/button/base';
import {
  Card,
  CardDescription,
  CardTitle,
} from '@/components/beui/motion/card';
import {
  CenterMorphModal,
  CenterMorphModalContent,
} from '@/components/beui/motion/center-morph-modal';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/beui/motion/context-menu';
import { Drawer } from '@/components/beui/motion/drawer';
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
import {
  SortableList,
  SortableListGroup,
  SortableListHandle,
  SortableListItem,
} from '@/components/beui/motion/sortable-stack';
import { TINTED_DANGER } from '@/components/notice';
import { TASK_TYPES } from '@/components/task-status';
import { ApiError, api } from '@/lib/api';
import { Lines } from '../../onboardings/changes';
import {
  ASSIGNEES,
  type AssigneeKey,
  assigneeKey,
  assigneeRule,
  dayOf,
  signed,
  TaskSummary,
  titleOf,
} from './phases';

const list = new Intl.ListFormat('en-US');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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

export const TYPE_HINTS: Record<TaskDef['type'], string> = {
  CHECKLIST: 'Someone marks it done',
  DOCUMENT: 'Files are uploaded',
  APPROVAL: 'Reviews a document',
};

// A task's row holds its drag handle, then the button that opens the task. The row takes the
// list-row layer over its own white while that button is hovered or pressed (ADR 009).
const ROW =
  'gap-0 p-0 transition-colors has-[[data-pick]:hover]:bg-[color-mix(in_srgb,var(--foreground)_5%,var(--background))] has-[[data-pick]:active]:bg-[color-mix(in_srgb,var(--foreground)_8%,var(--background))]';
const PICK =
  'flex min-w-0 flex-1 items-center gap-3 rounded-r-[15px] py-3 pr-3 pl-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset';
const GHOST = 'hover:bg-foreground/5 active:bg-foreground/8';
const MENU_BUTTON =
  'flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-primary active:bg-foreground/8 aria-expanded:bg-foreground/8 aria-expanded:text-foreground';
const TRIGGER = 'h-11 border-foreground/12';
const ERROR = { errorMessage: 'text-danger-strong' };
const MARKED =
  'bg-destructive/10 text-danger-strong ring-1 ring-destructive/30 ring-inset [&_button]:text-danger-strong';
const HINT = 'px-1 text-xs leading-4 text-muted-foreground';
// A white circle inset in the stepper's pill; gone where the stepper hides it at a limit.
const STEP =
  'border-4 bg-background hover:bg-[color-mix(in_srgb,var(--foreground)_5%,var(--background))] disabled:bg-transparent';

// From this width the panel sits beside the phases; below it, a task opens in a drawer.
const WIDE = '(min-width: 1280px)';
const subscribeWide = (onChange: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
export const useWide = () =>
  useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );

/** Focuses what the next render puts where the focused control was. */
const focusSoon = (selector: string) =>
  requestAnimationFrame(() =>
    document.querySelector<HTMLElement>(selector)?.focus(),
  );

type Phase = TemplateDefinition['phases'][number];
type Doomed = { kind: 'task' | 'phase'; key: string };

/**
 * A draft as edited (FR-04): core checks the whole definition after every change
 * (BR-T04–T10), and the draft saves itself a moment later, problems and all: they only stop
 * publishing (BR-T03). It lives above the editor, so viewing another version keeps it.
 */
export function useDraft(version: TemplateVersion) {
  const [definition, setDefinition] = useState(version.definition);
  const { valid, issues } = useMemo(() => {
    // Checked as the API stores it, titles trimmed (BR-T04).
    const parsed = templateDefinitionSchema.safeParse(definition);
    return {
      valid: parsed.success,
      issues: validateTemplate(parsed.success ? parsed.data : definition),
    };
  }, [definition]);
  const save = useAutosave(version.id, definition, valid);
  return { definition, setDefinition, valid, issues, save };
}
export type Draft = ReturnType<typeof useDraft>;

/**
 * HR edits a draft (FR-04): its phases and their tasks, added, renamed, reordered and deleted
 * in place, and each task in the panel.
 */
export function Editor({
  version,
  draft,
}: {
  version: TemplateVersion;
  draft: Draft;
}) {
  const { definition, setDefinition, issues, save } = draft;
  const [selectedKey, setSelectedKey] = useState(definition.tasks[0]?.key);
  // The phase whose Add task field is open.
  const [adding, setAdding] = useState<string | null>(null);
  const [doomed, setDoomed] = useState<Doomed | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // What a dialog gives focus back to, and whether it hid the drawer to open.
  const opener = useRef<HTMLElement | null>(null);
  const reopen = useRef(false);
  const emptyId = useId();
  const wide = useWide();
  const saveLine = (
    <SaveLine state={save.state} draft={version.version} onRetry={save.retry} />
  );

  const selected =
    definition.tasks.find(({ key }) => key === selectedKey) ??
    definition.tasks[0];

  const pick = (key: string) => {
    setSelectedKey(key);
    if (!wide) setDrawerOpen(true);
  };
  // An empty phase goes at once; anything else asks first.
  const askDelete = (target: Doomed, from: HTMLElement | null) => {
    if (
      target.kind === 'phase' &&
      !definition.tasks.some(({ phase }) => phase === target.key)
    ) {
      setDefinition((current) => ({
        ...current,
        phases: current.phases.filter(({ key }) => key !== target.key),
      }));
      focusSoon('[data-add-phase]');
      return;
    }
    opener.current = from;
    // The dialog can't open over the drawer's focus trap: the drawer steps aside until Keep.
    reopen.current = drawerOpen;
    setDrawerOpen(false);
    setDoomed(target);
  };
  const remove = () => {
    if (!doomed) return;
    const { kind, key } = doomed;
    const keys = definition.tasks
      .filter((task) => (kind === 'task' ? task.key : task.phase) === key)
      .map((task) => task.key);
    // The task now in the deleted one's place, else the one before it, takes the panel.
    const left = definition.tasks.filter((task) => !keys.includes(task.key));
    let next = left.find((task) => task.key === selected?.key);
    if (!next && kind === 'task') {
      const around = definition.tasks.filter(
        (task) => task.phase === selected?.phase,
      );
      const at = around.findIndex((task) => task.key === key);
      next = around[at + 1] ?? around[at - 1];
    }
    next ??= left[0];
    setSelectedKey(next?.key);
    setDefinition((current) =>
      withoutTasks(
        kind === 'phase'
          ? {
              ...current,
              phases: current.phases.filter((phase) => phase.key !== key),
            }
          : current,
        keys,
      ),
    );
    setDoomed(null);
    reopen.current = false;
    focusSoon(next ? `[data-pick="${next.key}"]` : '[data-add-phase]');
  };
  const keep = () => {
    setDoomed(null);
    if (reopen.current) setDrawerOpen(true);
    else opener.current?.focus();
    reopen.current = false;
  };

  // A new template: nothing to check yet, so no alert until it has a phase.
  if (definition.phases.length === 0 && definition.tasks.length === 0) {
    return (
      <Card
        variant="muted"
        className="items-center gap-2 px-6 py-12 text-center"
      >
        <CardTitle as="h2">Start with a phase</CardTitle>
        <CardDescription className="max-w-110">
          Phases group the tasks, like Before day 1 or Week 1. Add one, then its
          tasks.
        </CardDescription>
        <AddPhase
          definition={definition}
          onChange={setDefinition}
          onAdded={setAdding}
          className="mt-3 w-full max-w-md justify-center"
        />
      </Card>
    );
  }
  const deleteButton = selected && (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Delete ${titleOf(selected)}`}
      onClick={(event) =>
        askDelete({ kind: 'task', key: selected.key }, event.currentTarget)
      }
      className={cn('shrink-0', GHOST)}
    >
      <Trash3 aria-hidden className="size-4" />
    </Button>
  );
  return (
    <>
      {!wide && saveLine}
      {issues.length > 0 && <Problems issues={issues} />}
      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-3 text-sm">
          {definition.phases.map((phase, index) => (
            <PhaseCard
              key={phase.key}
              phase={phase}
              index={index}
              definition={definition}
              issues={issues}
              current={wide || drawerOpen ? selected?.key : undefined}
              onChange={setDefinition}
              onPick={pick}
              adding={adding === phase.key}
              onAdding={(open) => setAdding(open ? phase.key : null)}
              onAdded={setSelectedKey}
              onDelete={(from) =>
                askDelete({ kind: 'phase', key: phase.key }, from)
              }
            />
          ))}
          <AddPhase
            definition={definition}
            onChange={setDefinition}
            onAdded={setAdding}
          />
        </div>
        {wide &&
          (selected ? (
            <TaskPanel
              key={selected.key}
              task={selected}
              definition={definition}
              issues={issues}
              onChange={setDefinition}
              actions={deleteButton}
              footer={saveLine}
            />
          ) : (
            <section
              aria-labelledby={emptyId}
              className="flex min-w-0 flex-[999_1_480px] flex-col gap-4 rounded-2xl border border-border p-6"
            >
              <h2
                id={emptyId}
                className="text-[15px] leading-[21px] font-semibold"
              >
                Edit task
              </h2>
              <p className="text-muted-foreground">
                Add a task to a phase, and it opens here.
              </p>
              {saveLine}
            </section>
          ))}
      </div>
      {!wide && selected && (
        <Drawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          ariaLabel="Edit task"
          className="w-120 max-w-full"
        >
          <TaskPanel
            key={selected.key}
            drawer
            task={selected}
            definition={definition}
            issues={issues}
            onChange={setDefinition}
            actions={
              <>
                {deleteButton}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close"
                  onClick={() => setDrawerOpen(false)}
                  className="size-9 shrink-0 rounded-full bg-foreground/4 hover:bg-foreground/9 active:bg-foreground/12"
                >
                  <X aria-hidden className="size-4" />
                </Button>
              </>
            }
            footer={saveLine}
          />
        </Drawer>
      )}
      <DeleteDialog
        doomed={doomed}
        definition={definition}
        draft={version.version}
        onDelete={remove}
        onKeep={keep}
      />
    </>
  );
}

/**
 * A phase of the draft (FR-05): its tasks in order, each dragged by its handle within the
 * phase (PLAN §10.1), then Add task. Its ⋯ renames, moves or deletes it.
 */
function PhaseCard({
  phase,
  index,
  definition,
  issues,
  current,
  onChange,
  onPick,
  adding,
  onAdding,
  onAdded,
  onDelete,
}: {
  phase: Phase;
  index: number;
  definition: TemplateDefinition;
  issues: TemplateIssue[];
  // The task shown in the panel, if one shows.
  current: string | undefined;
  onChange: Dispatch<SetStateAction<TemplateDefinition>>;
  onPick: (key: string) => void;
  adding: boolean;
  onAdding: (open: boolean) => void;
  onAdded: (key: string) => void;
  onDelete: (opener: HTMLElement | null) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const tasks = definition.tasks.filter((task) => task.phase === phase.key);
  const full = definition.tasks.length >= MAX_TASKS;
  const heading = `phase-${phase.key}`;
  const setPhases = (update: (phases: Phase[]) => Phase[]) =>
    onChange((current) => ({ ...current, phases: update(current.phases) }));

  const move = (by: -1 | 1) => {
    setPhases((phases) => {
      const next = [...phases];
      const at = next.findIndex(({ key }) => key === phase.key);
      [next[at], next[at + by]] = [next[at + by], next[at]];
      return next;
    });
    // Moving the section drops the focus its ⋯ had.
    requestAnimationFrame(() => more.current?.focus());
  };
  // The phase's places in the list take its tasks in their new order (PLAN §4.2). An order
  // that no longer matches the phase (a task added mid-drag) is dropped, so none is lost.
  const reorder = (keys: string[]) =>
    onChange((current) => {
      const byKey = new Map(current.tasks.map((task) => [task.key, task]));
      const order = keys.flatMap((key) => byKey.get(key) ?? []);
      const places = current.tasks.filter((task) => task.phase === phase.key);
      if (
        order.length !== places.length ||
        order.some((task) => task.phase !== phase.key)
      ) {
        return current;
      }
      let i = 0;
      return {
        ...current,
        tasks: current.tasks.map((task) =>
          task.phase === phase.key ? order[i++] : task,
        ),
      };
    });
  // Last in the phase, a checklist for the new hire that opens and is due like the task
  // above it (day 1 in an empty phase).
  const addTask = (title: string) => {
    if (full) return;
    const above = tasks.at(-1);
    const task: TaskDef = {
      key: keyFor(
        title,
        definition.tasks.map(({ key }) => key),
        'task',
      ),
      phase: phase.key,
      title,
      type: 'CHECKLIST',
      assignee: { kind: 'NEW_HIRE' },
      availableOffsetDays: above?.availableOffsetDays ?? 0,
      dueOffsetDays: above?.dueOffsetDays ?? 0,
      dependsOn: [],
    };
    onChange((current) => ({ ...current, tasks: [...current.tasks, task] }));
    onAdded(task.key);
  };

  return (
    <section aria-labelledby={heading} className="rounded-[20px] bg-card p-2">
      <div className="flex min-h-[37px] items-center justify-between gap-2 py-1 pr-1.5 pl-2.5">
        {renaming ? (
          <PhaseName
            name={phase.name}
            onDone={(name, keyboard) => {
              if (name && name !== phase.name) {
                setPhases((phases) =>
                  phases.map((p) => (p.key === phase.key ? { ...p, name } : p)),
                );
              }
              setRenaming(false);
              if (keyboard) requestAnimationFrame(() => more.current?.focus());
            }}
          />
        ) : (
          <>
            <h2
              id={heading}
              className="text-[15px] leading-[21px] font-semibold"
            >
              {phase.name}
            </h2>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="text-xs text-muted-foreground">
                {tasks.length > 0 ? plural(tasks.length, 'task') : 'No tasks'}
              </span>
              <ContextMenu>
                <ContextMenuTrigger openOnClick>
                  <button
                    ref={more}
                    type="button"
                    aria-label={`More actions for ${phase.name}`}
                    className={MENU_BUTTON}
                  >
                    <More aria-hidden className="size-4" />
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent ariaLabel="Phase actions">
                  <ContextMenuLabel className="max-w-64 truncate">
                    {phase.name}
                  </ContextMenuLabel>
                  <ContextMenuItem onSelect={() => setRenaming(true)}>
                    <Edit2 aria-hidden className="size-3.5" />
                    Rename
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={index === 0}
                    onSelect={() => move(-1)}
                  >
                    <ArrowUp aria-hidden className="size-3.5" />
                    Move up
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={index === definition.phases.length - 1}
                    onSelect={() => move(1)}
                  >
                    <ArrowDown aria-hidden className="size-3.5" />
                    Move down
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    tone="destructive"
                    className="text-danger-strong"
                    onSelect={() => onDelete(more.current)}
                  >
                    <Trash3 aria-hidden className="size-3.5" />
                    {tasks.length > 0 ? 'Delete phase…' : 'Delete phase'}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </div>
          </>
        )}
      </div>
      {tasks.length > 0 && (
        <SortableList
          items={tasks.map((task) => ({ id: task.key, task }))}
          onItemsChange={(items) => reorder(items.map(({ id }) => id))}
          getItemLabel={({ task }) => titleOf(task)}
          label={`${phase.name} tasks`}
          className="max-w-none"
        >
          <SortableListGroup>
            {tasks.map((task) => {
              const shown = task.key === current;
              const count = issues.filter(({ taskKeys }) =>
                taskKeys.includes(task.key),
              ).length;
              return (
                <SortableListItem
                  key={task.key}
                  id={task.key}
                  className={cn(
                    ROW,
                    shown && 'border-primary ring-1 ring-primary',
                  )}
                >
                  <SortableListHandle className={cn('ml-1.5', GHOST)} />
                  <button
                    type="button"
                    data-pick={task.key}
                    aria-current={shown || undefined}
                    onClick={() => onPick(task.key)}
                    className={PICK}
                  >
                    <TaskSummary task={task} selected={shown} />
                    {count > 0 && (
                      <AnimatedBadge
                        size="sm"
                        status="danger"
                        icon={<XCircle className="size-3" />}
                        className="shrink-0 text-danger-strong"
                      >
                        {plural(count, 'problem')}
                      </AnimatedBadge>
                    )}
                  </button>
                </SortableListItem>
              );
            })}
          </SortableListGroup>
        </SortableList>
      )}
      {adding ? (
        <TitleField
          label={`New task in ${phase.name}`}
          placeholder="Task title"
          maxLength={120}
          hint={
            full
              ? `A template holds up to ${MAX_TASKS} tasks.`
              : 'Enter adds it and keeps this field open for the next one. Esc closes it.'
          }
          keepOpen
          onAdd={addTask}
          onClose={(how) => {
            onAdding(false);
            if (how === 'escape') focusSoon(`[data-add-task="${phase.key}"]`);
          }}
          className="mt-2"
        />
      ) : (
        <div className="mt-2 ml-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Button
            variant="ghost"
            size="sm"
            data-add-task={phase.key}
            disabled={full}
            onClick={() => onAdding(true)}
            aria-label={`Add task to ${phase.name}`}
            className={cn('text-[13px]', GHOST)}
          >
            <Plus aria-hidden className="size-3.5" />
            Add task
          </Button>
          {full && (
            <span className={HINT}>
              A template holds up to {MAX_TASKS} tasks.
            </span>
          )}
        </div>
      )}
    </section>
  );
}

/** A phase's name, edited in place: Enter or clicking away keeps it, Esc or nothing doesn't. */
function PhaseName({
  name,
  onDone,
}: {
  name: string;
  onDone: (name: string | undefined, keyboard: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  // Ending unmounts the field; a blur that follows must not end it twice.
  const done = useRef(false);
  const finish = (value: string | undefined, keyboard: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(value?.trim(), keyboard);
  };
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  return (
    <Input
      ref={input}
      defaultValue={name}
      aria-label="Phase name"
      maxLength={60}
      autoComplete="off"
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(event.currentTarget.value, true);
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(undefined, true);
        }
      }}
      onBlur={(event) => finish(event.currentTarget.value, false)}
      className="flex-1"
      classNames={{
        field: 'h-9 bg-background',
        input: 'text-[15px] font-semibold',
      }}
    />
  );
}

/** A title typed in place (M4.1b): Enter or clicking away adds it, Esc drops it. */
function TitleField({
  label,
  placeholder,
  hint,
  maxLength,
  keepOpen = false,
  onAdd,
  onClose,
  className,
}: {
  label: string;
  placeholder: string;
  hint: string;
  maxLength: number;
  // Enter leaves the field open, empty, for the next one.
  keepOpen?: boolean;
  onAdd: (text: string, how: 'enter' | 'blur') => void;
  onClose: (how: 'enter' | 'blur' | 'escape') => void;
  className?: string;
}) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  // Closing unmounts the field; a blur that follows must not add or close twice.
  const done = useRef(false);
  const hintId = useId();
  const finish = (how: 'enter' | 'blur' | 'escape') => {
    if (done.current) return;
    const value = text.trim();
    if (how === 'enter' && (keepOpen || !value)) {
      if (value) onAdd(value, how);
      setText('');
      return;
    }
    done.current = true;
    if (value && how !== 'escape') onAdd(value, how);
    onClose(how);
  };
  useEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Input
        ref={input}
        value={text}
        onChange={setText}
        aria-label={label}
        aria-describedby={hintId}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        onKeyDown={(event) => {
          if (event.key === 'Enter') finish('enter');
          if (event.key === 'Escape') {
            event.preventDefault();
            finish('escape');
          }
        }}
        onBlur={() => finish('blur')}
        classNames={{ field: 'bg-background' }}
      />
      <p id={hintId} className={HINT}>
        {hint}
      </p>
    </div>
  );
}

/** Add phase, last in the list; Enter then opens the field for its first task. */
function AddPhase({
  definition,
  onChange,
  onAdded,
  className,
}: {
  definition: TemplateDefinition;
  onChange: Dispatch<SetStateAction<TemplateDefinition>>;
  onAdded: (key: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const full = definition.phases.length >= MAX_PHASES;
  const add = (name: string) => {
    const key = keyFor(
      name,
      definition.phases.map((phase) => phase.key),
      'phase',
    );
    onChange((current) => ({
      ...current,
      phases: [...current.phases, { key, name }],
    }));
    return key;
  };
  if (open) {
    return (
      <div className={cn('rounded-[20px] bg-card p-2 text-left', className)}>
        <TitleField
          label="New phase"
          placeholder="Phase name"
          maxLength={60}
          hint="Enter adds it and opens its first task. Esc closes it."
          onAdd={(name, how) => {
            const key = add(name);
            if (how === 'enter') onAdded(key);
          }}
          onClose={(how) => {
            setOpen(false);
            if (how === 'escape') focusSoon('[data-add-phase]');
          }}
        />
      </div>
    );
  }
  return (
    <div
      className={cn('flex flex-wrap items-center gap-x-2 gap-y-1', className)}
    >
      <Button
        variant="outline"
        size="sm"
        data-add-phase
        disabled={full}
        onClick={() => setOpen(true)}
        className={cn(
          'h-9 border-dashed border-foreground/20 px-3.5 text-[13px]',
          GHOST,
        )}
      >
        <Plus aria-hidden className="size-3.5" />
        Add phase
      </Button>
      {full && (
        <span className={HINT}>
          A template holds up to {MAX_PHASES} phases.
        </span>
      )}
    </div>
  );
}

/** Asks before a task, or a phase and its tasks, go, saying which links go with them. */
function DeleteDialog({
  doomed,
  definition,
  draft,
  onDelete,
  onKeep,
}: {
  doomed: Doomed | null;
  definition: TemplateDefinition;
  draft: number;
  onDelete: () => void;
  onKeep: () => void;
}) {
  // The modal re-runs its focus effect whenever this callback changes, so it stays one function.
  const keep = useRef(onKeep);
  useEffect(() => {
    keep.current = onKeep;
  });
  const onOpenChange = useCallback((open: boolean) => {
    if (!open) keep.current();
  }, []);
  const what = doomed && consequences(doomed, definition);
  return (
    <CenterMorphModal open={doomed !== null} onOpenChange={onOpenChange}>
      <CenterMorphModalContent
        ariaLabel={what?.title ?? ''}
        closeButtonLabel="Close"
        // The drawer's scrim (Foundations).
        backdropClassName="bg-black/40"
      >
        {what && (
          <div className="flex flex-col gap-4.5 p-6">
            <h2 className="pr-10 text-xl leading-7 font-semibold tracking-tight">
              {what.title}
            </h2>
            <p className="-mt-3 text-[13px] leading-5 text-muted-foreground">
              Only draft v{draft} changes. Running onboardings keep the version
              they started with.
            </p>
            {what.lines.length > 0 && (
              <Lines lines={what.lines.map((text) => ({ text, gone: true }))} />
            )}
            <div className="flex flex-col gap-2">
              <Button size="lg" className={TINTED_DANGER} onClick={onDelete}>
                {what.action}
              </Button>
              <Button variant="secondary" className={GHOST} onClick={onKeep}>
                {what.keep}
              </Button>
            </div>
          </div>
        )}
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}

/** What deleting takes along: the phase's tasks, and every link other tasks had to them. */
function consequences(
  { kind, key }: Doomed,
  { phases, tasks }: TemplateDefinition,
) {
  const gone = tasks.filter(
    (task) => (kind === 'task' ? task.key : task.phase) === key,
  );
  const goneKeys = new Set(gone.map((task) => task.key));
  const titled = (ref: string) => titleOf(gone.find((t) => t.key === ref)!);
  const links = tasks
    .filter((task) => !goneKeys.has(task.key))
    .flatMap((task) => [
      ...(task.reviews && goneKeys.has(task.reviews)
        ? [
            `${titleOf(task)} loses the document it reviews: pick another one for it before you publish`,
          ]
        : []),
      ...task.dependsOn
        .filter((ref) => goneKeys.has(ref))
        .map(
          (ref) =>
            `${titleOf(task)} no longer waits for ${kind === 'task' ? 'it' : titled(ref)}`,
        ),
    ]);
  if (kind === 'task') {
    return gone[0]
      ? {
          title: `Delete ${titleOf(gone[0])}?`,
          lines: links,
          action: 'Delete task',
          keep: 'Keep task',
        }
      : null;
  }
  const phase = phases.find((p) => p.key === key);
  return phase
    ? {
        title: `Delete ${phase.name} and its ${plural(gone.length, 'task')}?`,
        lines: [
          `${list.format(gone.map(titleOf))} ${gone.length === 1 ? 'goes' : 'go'} with it`,
          ...links,
        ],
        action: 'Delete phase',
        keep: 'Keep phase',
      }
    : null;
}

/** Every problem in one alert, as the Publish button counts them. */
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
  actions,
  footer,
  drawer = false,
}: {
  task: TaskDef;
  definition: TemplateDefinition;
  issues: TemplateIssue[];
  onChange: Dispatch<SetStateAction<TemplateDefinition>>;
  // Buttons beside the heading: Delete, and Close in the drawer.
  actions: ReactNode;
  footer: ReactNode;
  // Below 1280 px the panel fills a drawer, its fields scrolling between a fixed head and foot.
  drawer?: boolean;
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
      className={
        drawer
          ? 'flex h-full min-h-0 flex-col'
          : 'flex min-w-0 flex-[999_1_480px] flex-col gap-6 rounded-2xl border border-border p-6'
      }
    >
      <div
        className={cn(
          'flex items-center gap-2',
          drawer && 'border-b border-border px-6 py-4 max-sm:px-4',
        )}
      >
        <h2
          id={`${id}-heading`}
          className={cn(
            'flex-1 font-semibold',
            drawer ? 'text-lg leading-6' : 'text-[15px] leading-[21px]',
          )}
        >
          Edit task
        </h2>
        {actions}
      </div>
      <div
        className={cn(
          'flex flex-col gap-5',
          drawer && 'min-h-0 flex-1 overflow-y-auto px-6 py-5 max-sm:px-4',
        )}
      >
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
      {drawer ? (
        <div className="border-t border-border px-6 py-4 max-sm:px-4">
          {footer}
        </div>
      ) : (
        footer
      )}
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
  | { kind: 'conflict' }
  | { kind: 'invalid' };

/**
 * Saves the draft a moment after each change (PLAN §8: PUT the whole definition), one request
 * at a time: changes made meanwhile go in the next. A definition the schema refuses, a task
 * with no title, waits until it is fixed. A 409, or a 404, means the draft was published,
 * discarded or archived elsewhere, so saving stops. Leaving the page sends what is still unsent.
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
  const [conflict, setConflict] = useState(false);
  const loaded = useRef(definition);
  const unsent = useRef<TemplateDefinition | null>(null);
  // The PUTs on their way, until the last one is answered.
  const sending = useRef<Promise<void> | null>(null);
  const stopped = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const send = useCallback(() => {
    clearTimeout(timer.current);
    if (sending.current || stopped.current || !unsent.current) return;
    sending.current = (async () => {
      try {
        for (let body = unsent.current; body; body = unsent.current) {
          unsent.current = null;
          try {
            const version = await api(
              `/template-versions/${versionId}`,
              templateVersionSchema,
              { method: 'PUT', body },
            );
            // For the next visit; this page keeps what is being typed, untrimmed.
            queryClient.setQueryData(['template-version', versionId], version);
            setSaved({ definition: body, at: Date.now() });
          } catch (error) {
            if (
              error instanceof ApiError &&
              (error.status === 409 || error.status === 404)
            ) {
              stopped.current = true;
              unsent.current = null;
              setConflict(true);
            } else {
              unsent.current ??= body;
              setFailed(body);
            }
            return;
          }
        }
      } finally {
        sending.current = null;
      }
    })();
  }, [queryClient, versionId]);

  useEffect(() => {
    if (definition === loaded.current || stopped.current) return;
    clearTimeout(timer.current);
    unsent.current = valid ? definition : null;
    if (valid) timer.current = setTimeout(send, 600);
  }, [definition, valid, send]);

  useEffect(() => {
    const leave = (afterSending: boolean) => {
      const body = unsent.current;
      if (!body || stopped.current) return;
      unsent.current = null;
      // The page is going away: send it without waiting for the answer.
      const put = () =>
        void fetch(`/api/template-versions/${versionId}`, {
          method: 'PUT',
          keepalive: true,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      // Off to another page of the app, a PUT still on its way goes first, so this newer
      // definition lands last. A closing tab can't wait for it.
      if (afterSending && sending.current) void sending.current.finally(put);
      else put();
    };
    const hide = () => leave(false);
    window.addEventListener('pagehide', hide);
    return () => {
      window.removeEventListener('pagehide', hide);
      clearTimeout(timer.current);
      leave(true);
    };
  }, [versionId]);

  const state: SaveState = conflict
    ? { kind: 'conflict' }
    : !valid
      ? { kind: 'invalid' }
      : definition === saved.definition
        ? saved.at
          ? { kind: 'saved', at: saved.at }
          : { kind: 'idle' }
        : definition === failed
          ? { kind: 'failed' }
          : { kind: 'saving' };
  return {
    state,
    retry: send,
    // Publishing sends the last change first, and stops if it can't be saved.
    flush: async () => {
      send();
      await sending.current;
      if (stopped.current || unsent.current) throw new Error('Not saved');
    },
    // Discarding stops saving once the PUT on its way is answered; resume undoes it.
    stop: () => {
      stopped.current = true;
      clearTimeout(timer.current);
      return sending.current ?? Promise.resolve();
    },
    resume: () => {
      stopped.current = false;
      send();
    },
  };
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
    case 'conflict':
      return (
        <p role="alert" className={cn(line, 'flex-wrap text-danger-strong')}>
          <XCircle aria-hidden className="size-3.5" />
          Couldn&apos;t save: draft v{draft} was published, discarded or
          archived elsewhere.
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-sm font-medium text-primary-strong outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
          >
            Reload
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
