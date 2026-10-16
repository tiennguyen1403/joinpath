'use client';

import {
  type DocumentFile,
  type DocumentSubmission,
  downloadUrlSchema,
  type IsoDate,
  type MyTask,
  onboardingDetailSchema,
  type Task,
} from '@joinpath/core';
import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query';
import { Fragment, useId, useState } from 'react';
import {
  Check,
  DocumentText,
  Download,
  Eye,
  Image as ImageIcon,
  Lock,
  X,
} from 'reicon-react';
import { ApprovalCard } from '@/components/beui/agents/approval-card';
import { cn } from '@/components/beui/lib/utils';
import { AnimatedBadge } from '@/components/beui/motion/animated-badge';
import { Button } from '@/components/beui/motion/button/base';
import { Drawer } from '@/components/beui/motion/drawer';
import { formatBytes } from '@/components/beui/motion/file-upload';
import { Input } from '@/components/beui/motion/input';
import {
  ImageViewer,
  ImageViewerContent,
  ImageViewerThumbnail,
  type LightboxImage,
} from '@/components/beui/motion/morphing-lightbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/beui/motion/tabs';
import { Notice } from '@/components/notice';
import { eventsOf, History, type Settle } from '@/components/task-work';
import { api, ApiError } from '@/lib/api';
import { firstName, formatDate, formatMomentIn } from '@/lib/format';

// A signed link lasts 5 minutes (PLAN §9): one at most 4 minutes old still has time to load.
const FRESH = 4 * 60_000;
const linkOf = (id: string) => ({
  queryKey: ['file-url', id],
  queryFn: () => api(`/files/${id}/download-url`, downloadUrlSchema),
  staleTime: FRESH,
  // A click asks once: a failure shows at once, and another click tries again.
  retry: false,
});
// The lightbox needs an image's size before it opens, so a preview is the loaded image.
const previewOf = (id: string) => ({
  queryKey: ['file-preview', id],
  queryFn: async () => {
    const { url } = await api(`/files/${id}/download-url`, downloadUrlSchema);
    const image = new Image();
    image.src = url;
    await image.decode();
    return { url, width: image.naturalWidth, height: image.naturalHeight };
  },
  staleTime: FRESH,
  // A file that doesn't decode won't on a second try; Retry is a click away.
  retry: false,
});

const messageOf = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : 'Check your connection and try again.';

const kindOf = ({ fileName, mimeType }: DocumentFile) =>
  (fileName.includes('.')
    ? fileName.split('.').pop()!
    : mimeType.split('/')[1]
  ).toUpperCase();

/**
 * The approver's review of a document (PLAN §10, ReviewTask): each revision's files, the
 * history, and the decision on the newest revision. Opened from My Tasks.
 */
export function ReviewDrawer({
  open,
  onOpenChange,
  approval,
  ...rest
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  approval: MyTask | undefined;
  tasks: Task[];
  today: IsoDate;
  viewerId: string;
  timeZone: string;
  settle: Settle;
  refresh: () => void;
}) {
  return (
    <Drawer
      open={open && Boolean(approval)}
      onOpenChange={onOpenChange}
      ariaLabel={approval?.title}
      className="w-130 max-w-full overflow-y-auto"
    >
      {approval && (
        <Review
          approval={approval}
          onClose={() => onOpenChange(false)}
          {...rest}
        />
      )}
    </Drawer>
  );
}

function Review({
  approval,
  tasks,
  today,
  viewerId,
  timeZone,
  settle,
  refresh,
  onClose,
}: {
  approval: MyTask;
  tasks: Task[];
  today: IsoDate;
  viewerId: string;
  timeZone: string;
  settle: Settle;
  refresh: () => void;
  onClose: () => void;
}) {
  const hire = approval.onboarding.employee;
  // Every approval reviews a document (BR-T08).
  const reviewed = tasks.find(({ id }) => id === approval.reviewsTaskId);
  const submissions = reviewed?.submissions ?? [];
  const [newest] = submissions;
  // A tab picked under an older newest gives way to the one a reload brought.
  const [picked, setPicked] = useState<{ id: string; newest: string }>();
  const shown =
    (picked?.newest === newest?.id &&
      submissions.find(({ id }) => id === picked.id)) ||
    newest;
  const deciding = approval.availability === 'READY';
  const owner = reviewed?.assignee;

  // A reason sends the revision back; none approves it.
  const decide = useMutation({
    mutationFn: ({
      submission,
      reason,
    }: {
      submission: DocumentSubmission;
      reason?: string;
    }) =>
      api(
        `/tasks/${approval.id}/${reason === undefined ? 'approve' : 'reject'}`,
        onboardingDetailSchema,
        { method: 'POST', body: { submissionId: submission.id, reason } },
      ),
    onSuccess: (onboarding, { submission: { revision }, reason }) => {
      onClose();
      settle(
        onboarding,
        reason === undefined
          ? {
              status: 'success',
              title: `Approved revision ${revision}`,
              description: `${approval.title} · ${hire.fullName}`,
            }
          : {
              status: 'success',
              title: 'Changes requested',
              description: `${owner?.fullName} sees your note and can send revision ${revision + 1}.`,
            },
      );
    },
    // The card follows availability and the newest revision, so a 409 means the drawer is
    // behind: the reload shows what replaced it.
    onError: refresh,
  });

  return (
    <>
      <header className="flex items-start gap-4 border-b border-border px-6 py-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {deciding && (
            <AnimatedBadge
              size="sm"
              status="info"
              className="self-start text-primary-strong"
              icon={<Eye className="size-3" />}
            >
              Waiting for your review
            </AnimatedBadge>
          )}
          <h2 className="text-[22px] leading-7 font-semibold tracking-tight">
            {approval.title}
          </h2>
          <span className="text-muted-foreground">
            {hire.fullName} · {approval.onboarding.template.name} · due{' '}
            <span className="font-mono text-[13px]">
              {formatDate(approval.dueOn)}
            </span>
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close"
          onClick={onClose}
          className="size-9 shrink-0 rounded-full bg-foreground/4 hover:bg-foreground/9 active:bg-foreground/12"
        >
          <X className="size-4" />
        </Button>
      </header>

      <div className="flex flex-col gap-5 px-6 py-5">
        {shown && newest && (
          <>
            <div className="flex flex-col gap-2.5">
              {submissions.length > 1 ? (
                <Tabs
                  value={shown.id}
                  onValueChange={(id) => setPicked({ id, newest: newest.id })}
                >
                  <TabsList aria-label="Revisions">
                    {submissions.map(({ id, revision }) => (
                      <TabsTrigger
                        key={id}
                        value={id}
                        // White on the strong primary (ADR 009).
                        indicatorClassName="bg-primary-strong"
                      >
                        Revision {revision}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              ) : (
                <span className="text-[15px] leading-[21px] font-semibold">
                  Revision {shown.revision}
                </span>
              )}
              <span className="text-[13px] text-muted-foreground">
                Submitted by {shown.submittedBy.fullName} ·{' '}
                {formatMomentIn(shown.submittedAt, timeZone)}
              </span>
            </div>
            <Files key={shown.id} submission={shown} />
            {deciding && shown.id !== newest.id && (
              <p className="text-[13px] text-muted-foreground">
                The card below still decides revision {newest.revision}, the
                newest.
              </p>
            )}
          </>
        )}
        {owner && (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Lock aria-hidden className="size-3.5 shrink-0" />
            Only {firstName(owner.fullName)}, you and HR can open these files.
            Each link lasts 5 minutes.
          </p>
        )}
        <History
          events={eventsOf(submissions, viewerId)}
          timeZone={timeZone}
          level={3}
        />
      </div>

      {(decide.error || (deciding && newest)) && (
        <footer className="mt-auto flex flex-col gap-3 border-t border-border px-6 pt-4 pb-6">
          {decide.error && (
            <Notice
              variant="destructive"
              title={
                decide.variables?.reason === undefined
                  ? "Couldn't approve it"
                  : "Couldn't request changes"
              }
              text={messageOf(decide.error)}
            />
          )}
          {deciding && newest && owner && (
            <Decision
              key={newest.id}
              approval={approval}
              owner={owner}
              revision={newest.revision}
              tasks={tasks}
              today={today}
              viewerId={viewerId}
              busy={decide.isPending}
              onApprove={() => decide.mutate({ submission: newest })}
              onReject={(reason) =>
                decide.mutate({ submission: newest, reason })
              }
            />
          )}
        </footer>
      )}
    </>
  );
}

// Approve, or send it back with a note (BR-R04): always the newest revision (BR-R02).
function Decision({
  approval,
  owner,
  revision,
  tasks,
  today,
  viewerId,
  busy,
  onApprove,
  onReject,
}: {
  approval: MyTask;
  owner: { fullName: string };
  revision: number;
  tasks: Task[];
  today: IsoDate;
  viewerId: string;
  busy: boolean;
  onApprove: () => void;
  onReject: (reason: string) => void;
}) {
  const noteId = useId();
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);
  const name = firstName(owner.fullName);
  const unlocks = tasks.filter(({ dependsOn }) =>
    dependsOn.includes(approval.id),
  );
  return (
    <ApprovalCard
      title={`Approve ${name}'s documents?`}
      meta={`Revision ${revision}`}
      description={
        unlocks.length > 0 && (
          <>
            Approving unlocks{' '}
            {unlocks.map((next, i) => (
              <Fragment key={next.id}>
                {i > 0 && (i === unlocks.length - 1 ? ' and ' : ', ')}
                <span className="font-medium text-foreground">
                  {next.title}
                </span>{' '}
                for{' '}
                {next.assignee.id === viewerId ? 'you' : next.assignee.fullName}
                {next.availableOn > today &&
                  ` when it opens on ${formatDate(next.availableOn)}`}
              </Fragment>
            ))}
            .
          </>
        )
      }
      status={busy ? 'submitting' : 'pending'}
      approveLabel={
        <>
          <Check aria-hidden className="size-3.5" />
          Approve revision {revision}
        </>
      }
      onApprove={onApprove}
      onRequestChanges={() => {
        const reason = note.trim();
        if (reason) onReject(reason);
        else setMissing(true);
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={noteId} className="text-[13px] font-medium">
          Note to {name}{' '}
          <span className="font-normal text-muted-foreground">
            · needed if you request changes
          </span>
        </label>
        <Input
          id={noteId}
          value={note}
          onChange={(value) => {
            setNote(value);
            setMissing(false);
          }}
          placeholder={`What should ${name} fix?`}
          maxLength={1000}
          disabled={busy}
          error={missing && `Say what ${name} should change`}
          className="p-0.5"
          classNames={{
            // As the card's own answer field; the border shows only for an error.
            field: cn(
              'h-10 rounded-xl bg-background/70 focus-within:bg-background',
              !missing && 'border-transparent',
            ),
            input: 'px-3 text-sm',
            errorMessage: 'text-danger-strong',
          }}
        />
      </div>
    </ApprovalCard>
  );
}

// The revision's files in upload order: images to preview and open, PDFs to download.
function Files({ submission }: { submission: DocumentSubmission }) {
  const queryClient = useQueryClient();
  const [downloadFailed, setDownloadFailed] = useState<{
    name: string;
    text: string;
  }>();
  const { revision, files } = submission;
  const images = files.filter(({ mimeType }) => mimeType !== 'application/pdf');
  const pdfs = files.filter(({ mimeType }) => mimeType === 'application/pdf');
  const previews = useQueries({
    queries: images.map(({ id }) => previewOf(id)),
  });
  const note = (file: DocumentFile) => (
    <>
      {kindOf(file)} · {formatBytes(file.sizeBytes)}
      {revision > 1 &&
        (file.carriedOver ? (
          ` · same as revision ${revision - 1}`
        ) : (
          <>
            {' · '}
            <span className="text-success-strong">
              new in revision {revision}
            </span>
          </>
        ))}
    </>
  );
  const loaded: LightboxImage[] = images.flatMap((file, i) => {
    const data = previews[i].data;
    return data
      ? [{ id: file.id, src: data.url, alt: file.fileName, ...data }]
      : [];
  });

  async function download(file: DocumentFile) {
    setDownloadFailed(undefined);
    try {
      const { url } = await queryClient.fetchQuery(linkOf(file.id));
      // The link answers with Content-Disposition: attachment, so the page stays.
      window.location.assign(url);
    } catch (error) {
      setDownloadFailed({ name: file.fileName, text: messageOf(error) });
    }
  }

  return (
    <>
      {images.length > 0 && (
        <ImageViewer
          images={loaded}
          label={`Images in revision ${revision}`}
          renderCaption={({ id, alt }) => {
            const file = images.find((each) => each.id === id)!;
            return (
              <>
                {alt}{' '}
                <span className="text-white/70">
                  · {kindOf(file)} · {formatBytes(file.sizeBytes)}
                </span>
              </>
            );
          }}
        >
          <section
            aria-label={`Images in revision ${revision}`}
            className="grid grid-cols-2 gap-3"
          >
            {images.map((file, i) => {
              const added = revision > 1 && !file.carriedOver;
              const { data, isError, refetch } = previews[i];
              return (
                <figure key={file.id} className="flex min-w-0 flex-col gap-2">
                  {data ? (
                    <ImageViewerThumbnail
                      imageId={file.id}
                      className="aspect-[1.58] w-full cursor-zoom-in"
                      imageClassName="h-full object-contain"
                    >
                      {added && <NewRing />}
                    </ImageViewerThumbnail>
                  ) : (
                    <span
                      role={isError ? 'status' : undefined}
                      aria-busy={!isError || undefined}
                      className={cn(
                        'relative flex aspect-[1.58] flex-col items-center justify-center gap-1.5 rounded-2xl bg-card p-2 text-center text-xs',
                        isError
                          ? 'text-muted-foreground'
                          : 'text-muted-foreground/60',
                      )}
                    >
                      {isError ? (
                        <>
                          Couldn&apos;t load the preview
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void refetch()}
                            className="h-7 bg-background px-2.5"
                          >
                            Retry
                          </Button>
                        </>
                      ) : (
                        <>
                          <ImageIcon aria-hidden className="size-5" />
                          <span className="sr-only">Loading the preview</span>
                        </>
                      )}
                      {added && <NewRing />}
                    </span>
                  )}
                  <figcaption className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-medium">
                      {file.fileName}
                    </span>
                    <span className="text-xs leading-4 text-muted-foreground">
                      {note(file)}
                    </span>
                  </figcaption>
                </figure>
              );
            })}
          </section>
          <ImageViewerContent />
        </ImageViewer>
      )}
      {downloadFailed && (
        <Notice
          variant="destructive"
          title={`Couldn't download ${downloadFailed.name}`}
          text={downloadFailed.text}
        />
      )}
      {pdfs.map((file) => (
        <div
          key={file.id}
          className="flex items-center gap-3 rounded-2xl border border-border p-3"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-card text-muted-foreground">
            <DocumentText aria-hidden className="size-5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium">{file.fileName}</span>
            <span className="mt-0.5 text-xs leading-4 text-muted-foreground">
              {note(file)}
            </span>
          </span>
          <Button
            variant="secondary"
            size="sm"
            aria-label={`Download ${file.fileName}`}
            onClick={() => void download(file)}
          >
            <Download aria-hidden className="size-3.5" />
            Download
          </Button>
        </div>
      ))}
    </>
  );
}

// A file new in this revision, rather than carried over from the one sent back.
const NewRing = () => (
  <span
    aria-hidden
    className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-success ring-inset"
  />
);
