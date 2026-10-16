'use client';

import {
  type DocumentSubmission,
  MAX_FILE_BYTES,
  MAX_FILE_MB,
  MAX_FILES_PER_SUBMISSION,
  type OnboardingDetail,
  onboardingDetailSchema,
  sniffMimeType,
  type Task,
} from '@joinpath/core';
import { useMutation } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { Check } from 'reicon-react';
import { Avatar } from '@/components/avatar';
import { cn } from '@/components/beui/lib/utils';
import type { ToastInput } from '@/components/beui/motion/animated-toast-stack';
import { Button } from '@/components/beui/motion/button/base';
import {
  FileUpload,
  type FileUploadItem,
} from '@/components/beui/motion/file-upload';
import { Notice } from '@/components/notice';
import { api, ApiError } from '@/lib/api';
import { capitalized, firstName, formatMomentIn, inWords } from '@/lib/format';

/** Puts a command's answer on the page, with a toast when there is one to show. */
export type Settle = (onboarding: OnboardingDetail, toast?: ToastInput) => void;

// Under the task's row: flush on a phone, under the title from sm up, as the canvas indents it.
const BODY = 'flex flex-col gap-4 pt-3 pr-1.5 pb-4 pl-1.5 sm:pl-10';
const PRIMARY = 'bg-primary-strong hover:bg-primary-strong/90';
const NOTE = 'text-[13px] leading-5 text-muted-foreground';

const messageOf = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : 'Check your connection and try again.';

/** The task's description, a step a line (My Tasks numbers them the same way). */
function Steps({ text }: { text: string | null }) {
  const steps = text?.split('\n').filter(Boolean) ?? [];
  if (steps.length < 2) return steps.length ? <p>{steps[0]}</p> : null;
  return (
    <ol aria-label="What to do" className="flex flex-col gap-1.5">
      {steps.map((step, i) => (
        <li key={step} className="flex gap-3">
          <span className="w-3 shrink-0 pt-px font-mono text-xs text-muted-foreground">
            {i + 1}
          </span>
          {step}
        </li>
      ))}
    </ol>
  );
}

/** A checklist of the new hire's, open today: its steps, then Mark complete. */
export function ChecklistWork({
  task,
  settle,
  refresh,
}: {
  task: Task;
  settle: Settle;
  refresh: () => void;
}) {
  const complete = useMutation({
    mutationFn: () =>
      api(`/tasks/${task.id}/complete`, onboardingDetailSchema, {
        method: 'POST',
        body: {},
      }),
    onSuccess: (onboarding) =>
      settle(onboarding, {
        status: 'success',
        title: 'Marked complete',
        description: task.title,
      }),
    // The button follows availability, so a refusal means the page is behind.
    onError: refresh,
  });
  return (
    <div className={BODY}>
      {complete.error && (
        <Notice
          variant="destructive"
          title="Couldn't mark it complete"
          text={messageOf(complete.error)}
        />
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Steps text={task.description} />
        <Button
          className={cn(PRIMARY, 'w-full sm:w-auto')}
          disabled={complete.isPending}
          onClick={() => complete.mutate()}
        >
          <Check aria-hidden className="size-4" />
          Mark complete
        </Button>
      </div>
    </div>
  );
}

// A file on its way, or one the API did not take; the uploaded ones are the task's `files`.
type Sending = {
  id: string;
  file: File;
  status: 'queued' | 'uploading' | 'error';
  error?: string;
};

// What the API would refuse anyway (BR-P04), said before the bytes go.
async function problemOf(file: File) {
  if (file.size > MAX_FILE_BYTES) return `is larger than ${MAX_FILE_MB} MB`;
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  return sniffMimeType(head) ? null : "isn't a PDF, PNG or JPEG";
}

/**
 * A document of the new hire's, open today (PLAN §4.5): why the last revision was sent back,
 * the files of the next one, and Submit. One request at a time, so each answer has every
 * change before it.
 */
export function DocumentWork({
  task,
  review,
  viewerId,
  timeZone,
  settle,
  refresh,
  className,
  level,
  demo,
}: {
  task: Task;
  review: Task | undefined;
  viewerId: string;
  timeZone: string;
  settle: Settle;
  refresh: () => void;
  /** Merged over the portal's indent under the task's row. */
  className?: string;
  level?: HeadingLevel;
  /** In a sandbox, where nothing should be real (PLAN §9). */
  demo?: boolean;
}) {
  const [sending, setSending] = useState<Sending[]>([]);
  // Files removed and awaiting the API's answer, hidden meanwhile.
  const [removing, setRemoving] = useState<string[]>([]);
  // Files the browser turned away, each a sentence.
  const [refused, setRefused] = useState<string[]>([]);
  const [failure, setFailure] = useState<{ title: string; text: string }>();
  const queue = useRef(Promise.resolve());
  const dropped = useRef(new Set<string>());
  const run = (job: () => Promise<void>) => {
    queue.current = queue.current.then(job);
  };

  const [last] = task.submissions;
  const revision = task.submissions.length + 1;
  const inFlight = sending.filter(({ status }) => status !== 'error');
  const full = task.files.length + inFlight.length >= MAX_FILES_PER_SUBMISSION;

  const submit = useMutation({
    mutationFn: () =>
      api(`/tasks/${task.id}/submit`, onboardingDetailSchema, {
        method: 'POST',
        body: {},
      }),
    onSuccess: (onboarding) =>
      settle(
        onboarding,
        review
          ? {
              status: 'success',
              title: 'Sent for review',
              description: `${review.assignee.fullName} reviews revision ${revision} next.`,
            }
          : { status: 'success', title: 'Submitted', description: task.title },
      ),
    onError: (error) => {
      setFailure({ title: "Couldn't submit", text: messageOf(error) });
      refresh();
    },
  });

  async function send(item: Sending) {
    if (dropped.current.has(item.id)) return;
    const mark = (change: Partial<Sending>) =>
      setSending((list) =>
        list.map((each) =>
          each.id === item.id ? { ...each, ...change } : each,
        ),
      );
    mark({ status: 'uploading' });
    const body = new FormData();
    body.append('file', item.file);
    try {
      settle(
        await api(`/tasks/${task.id}/files`, onboardingDetailSchema, {
          method: 'POST',
          body,
        }),
      );
      setSending((list) => list.filter(({ id }) => id !== item.id));
    } catch (error) {
      mark({
        status: 'error',
        error:
          error instanceof ApiError
            ? error.message
            : "Couldn't upload. Check your connection.",
      });
    }
  }

  async function add(files: File[]) {
    setFailure(undefined);
    let room = MAX_FILES_PER_SUBMISSION - task.files.length - inFlight.length;
    const turnedAway: string[] = [];
    const taken: Sending[] = [];
    for (const file of files) {
      const problem = await problemOf(file);
      if (problem) {
        turnedAway.push(`${file.name} ${problem}.`);
      } else if (room <= 0) {
        turnedAway.push(
          `${file.name} would make more than ${MAX_FILES_PER_SUBMISSION} files.`,
        );
      } else {
        room -= 1;
        taken.push({ id: crypto.randomUUID(), file, status: 'queued' });
      }
    }
    setRefused(turnedAway);
    setSending((list) => [...list, ...taken]);
    for (const item of taken) run(() => send(item));
  }

  function remove({ id, name }: FileUploadItem) {
    setFailure(undefined);
    // Never stored: there is nothing to delete.
    if (sending.some((item) => item.id === id)) {
      dropped.current.add(id);
      setSending((list) => list.filter((item) => item.id !== id));
      return;
    }
    setRemoving((ids) => [...ids, id]);
    run(async () => {
      try {
        settle(
          await api(`/tasks/${task.id}/files/${id}`, onboardingDetailSchema, {
            method: 'DELETE',
          }),
        );
      } catch (error) {
        setFailure({
          title: `Couldn't remove ${name}`,
          text: messageOf(error),
        });
        refresh();
      } finally {
        setRemoving((ids) => ids.filter((each) => each !== id));
      }
    });
  }

  function retry({ id }: FileUploadItem) {
    const item = sending.find((each) => each.id === id);
    if (!item) return;
    setSending((list) =>
      list.map((each) =>
        each.id === id ? { ...each, status: 'queued', error: undefined } : each,
      ),
    );
    run(() => send(item));
  }

  const items: FileUploadItem[] = [
    ...task.files
      .filter(({ id }) => !removing.includes(id))
      .map((file) => ({
        id: file.id,
        name: file.fileName,
        size: file.sizeBytes,
        type: file.mimeType,
        status: 'success' as const,
        note:
          last && !file.carriedOver ? (
            <>
              {' · '}
              <span className="text-success-strong">new in this revision</span>
            </>
          ) : undefined,
      })),
    ...sending.map(({ id, file, status, error }) => ({
      id,
      name: file.name,
      size: file.size,
      type: file.type,
      status,
      error,
    })),
  ];
  const busy = inFlight.length > 0 || removing.length > 0 || submit.isPending;

  return (
    <div className={cn(BODY, className)}>
      {last?.decision && (
        <ChangesRequested submission={last} timeZone={timeZone} />
      )}
      <Steps text={task.description} />
      {demo && (
        <Notice
          variant="info"
          title="Don't upload real documents"
          text="This is a demo and everyone in it is made up: any PDF, PNG or JPEG will do."
        />
      )}
      {failure && (
        <Notice
          variant="destructive"
          title={failure.title}
          text={failure.text}
        />
      )}
      {refused.length > 0 && (
        <Notice
          variant="warning"
          title={`${capitalized(inWords(refused.length))} ${
            refused.length === 1 ? "file wasn't" : "files weren't"
          } added`}
          text={refused.join(' ')}
        />
      )}
      <FileUpload
        value={items}
        onFilesAdded={(_, files) => void add(files)}
        onRemove={remove}
        onRetry={retry}
        accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg"
        disabled={full}
        title={full ? 'Upload limit reached' : 'Drop files here'}
        description={
          full
            ? `${MAX_FILES_PER_SUBMISSION} of ${MAX_FILES_PER_SUBMISSION} files added`
            : `PDF, PNG or JPEG · up to ${MAX_FILE_MB} MB each · ${MAX_FILES_PER_SUBMISSION} files at most`
        }
        queueLabel={
          last ? `Revision ${revision} · ready to submit` : 'Ready to submit'
        }
        classNames={{ action: 'hover:bg-foreground/5 active:bg-foreground/8' }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={cn(NOTE, 'max-w-90')}>
          {review
            ? `Once you submit, ${firstName(review.assignee.fullName)} reviews it. Files are locked while it's in review.`
            : "Once you submit, this task is done and the files can't be changed."}
        </span>
        <Button
          className={cn(PRIMARY, 'w-full sm:w-auto')}
          disabled={task.files.length === 0 || busy}
          onClick={() => submit.mutate()}
        >
          {submit.isPending
            ? 'Submitting…'
            : last
              ? `Submit revision ${revision}`
              : 'Submit'}
        </Button>
      </div>
      {/* The newest decision is the block above. */}
      <History
        events={eventsOf(task.submissions, viewerId).slice(1)}
        timeZone={timeZone}
        level={level}
      />
    </div>
  );
}

// Why the newest revision came back (BR-R06), as the approver wrote it.
function ChangesRequested({
  submission: { revision, decision },
  timeZone,
}: {
  submission: DocumentSubmission;
  timeZone: string;
}) {
  if (!decision?.reason) return null;
  return (
    <figure className="flex gap-3 rounded-2xl bg-destructive/5 px-4 py-3.5">
      <Avatar
        name={decision.decidedBy.fullName}
        className="size-8 bg-foreground/8 text-foreground"
      />
      <div className="flex flex-col gap-0.5">
        <blockquote className="leading-[23px]">“{decision.reason}”</blockquote>
        <figcaption className="text-xs leading-[18px] text-muted-foreground">
          {decision.decidedBy.fullName} on revision {revision} ·{' '}
          {formatMomentIn(decision.decidedAt, timeZone)}
        </figcaption>
      </div>
    </figure>
  );
}

/** A submitted document waiting for its review: what went, and who decides. */
export function InReview({
  task,
  review,
  viewerId,
  timeZone,
  className,
  level,
}: {
  task: Task;
  review: Task;
  viewerId: string;
  timeZone: string;
  className?: string;
  level?: HeadingLevel;
}) {
  const [last] = task.submissions;
  return (
    <div className={cn(BODY, className)}>
      {last && (
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-medium">
            Revision {last.revision} · submitted{' '}
            {formatMomentIn(last.submittedAt, timeZone)}
          </span>
          <span className="text-muted-foreground">
            {last.files.map(({ fileName }) => fileName).join(', ')}
          </span>
        </div>
      )}
      <span className={NOTE}>
        {review.assignee.fullName} reviews it next. Files are locked while
        it&apos;s in review.
      </span>
      {/* Its submission is the block above. */}
      <History
        events={eventsOf(task.submissions, viewerId).slice(1)}
        timeZone={timeZone}
        level={level}
      />
    </div>
  );
}

type Event = {
  key: string;
  tone: 'submitted' | 'rejected' | 'approved';
  who: string;
  what: string;
  reason?: string;
  at: string;
};

const LIST = new Intl.ListFormat('en-US');

/**
 * Each revision's submission and the decision on it, newest first, as the review drawer tells
 * them: "You" is whoever reads it.
 */
export function eventsOf(submissions: DocumentSubmission[], viewerId: string) {
  const name = ({ id, fullName }: { id: string; fullName: string }) =>
    id === viewerId ? 'You' : fullName;
  return submissions.flatMap(
    ({ id, revision, submittedBy, submittedAt, files, decision }): Event[] => {
      const added = files.filter(({ carriedOver }) => !carriedOver);
      const submitted: Event = {
        key: `${id}-submitted`,
        tone: 'submitted',
        who: name(submittedBy),
        what: `submitted revision ${revision}${
          revision > 1 && added.length
            ? `, adding ${LIST.format(added.map(({ fileName }) => fileName))}`
            : ''
        }`,
        at: submittedAt,
      };
      if (!decision) return [submitted];
      const approved = decision.decision === 'APPROVED';
      return [
        {
          key: `${id}-decided`,
          tone: approved ? 'approved' : 'rejected',
          who: name(decision.decidedBy),
          what: `${approved ? 'approved' : 'requested changes on'} revision ${revision}`,
          reason: decision.reason ?? undefined,
          at: decision.decidedAt,
        },
        submitted,
      ];
    },
  );
}

const DOT: Record<Event['tone'], string> = {
  submitted: 'bg-foreground/20',
  rejected: 'bg-destructive',
  approved: 'bg-success',
};

// Under the task's title: an h3 where that title is an h2, as in My Tasks and the drawer.
type HeadingLevel = 3 | 4;

export function History({
  events,
  timeZone,
  level = 4,
}: {
  events: Event[];
  timeZone: string;
  level?: HeadingLevel;
}) {
  const heading = useId();
  const Heading = level === 3 ? 'h3' : 'h4';
  if (!events.length) return null;
  return (
    <section
      aria-labelledby={heading}
      className="flex flex-col gap-2.5 border-t border-border pt-4"
    >
      <Heading id={heading} className="text-[13px] leading-5 font-medium">
        History
      </Heading>
      <ol className="flex flex-col gap-3">
        {events.map(({ key, tone, who, what, reason, at }) => (
          <li key={key} className="flex gap-3">
            <span
              aria-hidden
              className={cn('mt-1.5 size-2 shrink-0 rounded-full', DOT[tone])}
            />
            <span className="flex flex-col">
              <span>
                <span className="font-medium">{who}</span> {what}
              </span>
              {reason && (
                <span className="text-[13px] leading-[21px] text-foreground/80">
                  “{reason}”
                </span>
              )}
              <span className="text-xs leading-[18px] text-muted-foreground">
                {formatMomentIn(at, timeZone)}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
