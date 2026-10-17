'use client';

import {
  onboardingSummarySchema,
  type TaskDef,
  type Template,
  type TemplateVersion,
  templateSchema,
  templateVersionSchema,
} from '@joinpath/core';
import {
  type UseMutationResult,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { ArchiveBox, Edit, Loader, More, X } from 'reicon-react';
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
  type ToastInput,
  useAnimatedToastStack,
} from '@/components/beui/motion/animated-toast-stack';
import { Button } from '@/components/beui/motion/button/base';
import {
  CenterMorphModal,
  CenterMorphModalContent,
} from '@/components/beui/motion/center-morph-modal';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from '@/components/beui/motion/context-menu';
import { Drawer } from '@/components/beui/motion/drawer';
import { Tabs, TabsList, TabsTrigger } from '@/components/beui/motion/tabs';
import { Tooltip } from '@/components/beui/motion/tooltip';
import { EmptyState } from '@/components/empty-state';
import { Notice, TINTED_DANGER } from '@/components/notice';
import { TASK_TYPES } from '@/components/task-status';
import { Steps } from '@/components/task-work';
import { api, ApiError, messageOf } from '@/lib/api';
import { capitalized, formatDateIn, inWords } from '@/lib/format';
import { usePageCrumb } from '../../app-shell';
import { type Draft, Editor, TYPE_HINTS, useDraft, useWide } from './editor';
import {
  ASSIGNEES,
  assigneeKey,
  dayOf,
  Phases,
  signed,
  tabPanel,
  TaskSummary,
  TemplateGraph,
  titleOf,
  type View,
  ViewTabs,
} from './phases';

type VersionSummary = Template['versions'][number];

const GHOST = 'hover:bg-foreground/5 active:bg-foreground/8';
// The header's ⋯, as tall as its buttons; open, it keeps the pressed layer.
const MENU_BUTTON =
  'flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-foreground/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary active:bg-foreground/8 aria-expanded:bg-foreground/8 aria-expanded:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground';
// A task's row opens its details; hovered or pressed it takes the list-row layer (ADR 009).
const ROW =
  'flex w-full min-w-0 items-center gap-3 rounded-2xl border border-border bg-background p-3 text-left outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--foreground)_5%,var(--background))] focus-visible:ring-2 focus-visible:ring-primary active:bg-[color-mix(in_srgb,var(--foreground)_8%,var(--background))]';

/** Versions come newest first, so this is the one activation uses (BR-A03). */
const newestPublished = (template: Template) =>
  template.versions.find(({ status }) => status === 'PUBLISHED');
/** What new onboardings start from: none once archived (BR-T12). */
const currentOf = (template: Template) =>
  template.archivedAt ? undefined : newestPublished(template);
// A draft published, discarded or archived elsewhere answers 409, or 404 once it's gone.
const elsewhere = (error: unknown) =>
  error instanceof ApiError && (error.status === 409 || error.status === 404);

/**
 * A template opened from the list (FR-04), one version at a time behind tabs. Its draft is
 * edited, published or discarded here; without one, the current version shows and Edit starts
 * the next draft (BR-T02). Archived, it only reads.
 */
export function TemplateView({
  id,
  timeZone,
}: {
  id: string;
  timeZone: string;
}) {
  const { data: template, error } = useQuery({
    queryKey: ['template', id],
    queryFn: () => api(`/templates/${id}`, templateSchema),
  });
  const { toasts, showToast, dismissToast } = useAnimatedToastStack();
  // Phases or Graph, whichever version shows, and still after a publish; not in the URL, so a
  // reload opens the phases.
  const [view, setView] = useState<View>('phases');
  usePageCrumb(template?.name);

  if (!template) {
    if (
      error instanceof ApiError &&
      (error.status === 404 || error.status === 400)
    ) {
      return (
        <EmptyState
          title="Template not found"
          description="It may not exist, or it isn't one you can see."
        />
      );
    }
    return error ? <LoadFailed /> : null;
  }
  // At most one draft (BR-T02), and none that can change once archived.
  const draft = template.archivedAt
    ? undefined
    : template.versions.find(({ status }) => status === 'DRAFT');
  return (
    <>
      {draft ? (
        <DraftView
          key={draft.id}
          template={template}
          draftId={draft.id}
          timeZone={timeZone}
          showToast={showToast}
          view={view}
          onView={setView}
        />
      ) : (
        <PublishedView
          template={template}
          timeZone={timeZone}
          showToast={showToast}
          view={view}
          onView={setView}
        />
      )}
      <AnimatedToastStack toasts={toasts} onDismiss={dismissToast} fixed />
    </>
  );
}

/** No draft: the version new onboardings get, the others a tab away. */
function PublishedView({
  template,
  timeZone,
  showToast,
  view,
  onView,
}: {
  template: Template;
  timeZone: string;
  showToast: (toast: ToastInput) => void;
  view: View;
  onView: (view: View) => void;
}) {
  const current = currentOf(template);
  const [tab, setTab] = useState(
    (newestPublished(template) ?? template.versions[0]).id,
  );
  const shown =
    template.versions.find(({ id }) => id === tab) ?? template.versions[0];
  return (
    <>
      <Header
        template={template}
        shown={shown}
        timeZone={timeZone}
        action={shown === current && <EditButton templateId={template.id} />}
        menu={<TemplateMenu template={template} showToast={showToast} />}
      />
      <VersionTabs template={template} value={shown.id} onChange={setTab} />
      <ReadOnly
        key={shown.id}
        template={template}
        versionId={shown.id}
        view={view}
        onView={onView}
      />
    </>
  );
}

function DraftView({
  template,
  draftId,
  timeZone,
  showToast,
  view,
  onView,
}: {
  template: Template;
  draftId: string;
  timeZone: string;
  showToast: (toast: ToastInput) => void;
  view: View;
  onView: (view: View) => void;
}) {
  const { data: version, error } = useQuery({
    queryKey: ['template-version', draftId],
    queryFn: () => api(`/template-versions/${draftId}`, templateVersionSchema),
  });
  if (!version) return error ? <LoadFailed /> : null;
  return (
    <Drafting
      template={template}
      version={version}
      timeZone={timeZone}
      showToast={showToast}
      view={view}
      onView={onView}
    />
  );
}

/**
 * The draft, edited on its tab: it stays as typed, and keeps saving, while another version is
 * shown. Publishing sends the last change first (BR-T03), then the page reads v{n} as current.
 */
function Drafting({
  template,
  version,
  timeZone,
  showToast,
  view,
  onView,
}: {
  template: Template;
  version: TemplateVersion;
  timeZone: string;
  showToast: (toast: ToastInput) => void;
  view: View;
  onView: (view: View) => void;
}) {
  const queryClient = useQueryClient();
  const draft = useDraft(version);
  const [tab, setTab] = useState(version.id);
  const publish = useMutation({
    mutationFn: async () => {
      await draft.save.flush();
      return api(
        `/template-versions/${version.id}/publish`,
        templateVersionSchema,
        { method: 'POST' },
      );
    },
    onSuccess: (published) => {
      queryClient.setQueryData(['template-version', published.id], published);
      // The page then has no draft, so it shows the version just published.
      queryClient.setQueryData<Template>(
        ['template', template.id],
        (cached) =>
          cached && {
            ...cached,
            versions: cached.versions.map((v) =>
              v.id === published.id
                ? {
                    ...v,
                    status: published.status,
                    publishedAt: published.publishedAt,
                  }
                : v,
            ),
          },
      );
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
      showToast({
        status: 'success',
        title: `Published v${published.version}`,
        description:
          'New onboardings start from it. Running ones keep the version they started with.',
      });
    },
    // Nothing more to save to a draft that is gone or published.
    onError: (error) => {
      if (elsewhere(error)) void draft.save.stop();
    },
  });
  const shown =
    template.versions.find(({ id }) => id === tab) ?? template.versions[0];
  const editing = shown.id === version.id;
  return (
    <>
      <Header
        template={template}
        shown={shown}
        timeZone={timeZone}
        action={
          editing && (
            <DraftActions
              template={template}
              version={version}
              draft={draft}
              publish={publish}
              showToast={showToast}
            />
          )
        }
        menu={
          <TemplateMenu
            template={template}
            draft={draft}
            busy={publish.isPending}
            showToast={showToast}
          />
        }
      />
      <VersionTabs template={template} value={shown.id} onChange={setTab} />
      {editing ? (
        // Nothing changes while it publishes, so what goes out is what's on screen.
        <div inert={publish.isPending} className="contents">
          <Editor version={version} draft={draft} view={view} onView={onView} />
        </div>
      ) : (
        <ReadOnly
          key={shown.id}
          template={template}
          versionId={shown.id}
          view={view}
          onView={onView}
        />
      )}
    </>
  );
}

/**
 * The draft's buttons: Publish, off and saying why while anything stops it (BR-T03), and
 * Discard draft while a published version is left to fall back on (PLAN §7).
 */
function DraftActions({
  template,
  version,
  draft,
  publish,
  showToast,
}: {
  template: Template;
  version: TemplateVersion;
  draft: Draft;
  publish: UseMutationResult<TemplateVersion, Error, void>;
  showToast: (toast: ToastInput) => void;
}) {
  const [discarding, setDiscarding] = useState(false);
  const discardButton = useRef<HTMLButtonElement>(null);
  const published = newestPublished(template);
  const { definition, valid, issues, save } = draft;
  // A new template's empty draft shows no alert yet, so it gets its own reason.
  const why =
    definition.phases.length === 0 && definition.tasks.length === 0
      ? 'Add a phase and a task to publish'
      : !valid
        ? 'Give every task a title to publish'
        : issues.length > 0
          ? `Fix ${issues.length} ${issues.length === 1 ? 'problem' : 'problems'} to publish`
          : null;
  const gone =
    publish.error !== null &&
    (elsewhere(publish.error) || save.state.kind === 'conflict');
  const failure =
    publish.error &&
    (gone
      ? `Couldn't publish: draft v${version.version} was published, discarded or archived elsewhere.`
      : publish.error instanceof ApiError
        ? `Couldn't publish. ${publish.error.message}.`
        : "Couldn't publish. Check your connection and try again.");
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {published && (
          <Button
            ref={discardButton}
            variant="ghost"
            aria-disabled={publish.isPending || undefined}
            onClick={() => {
              if (!publish.isPending) setDiscarding(true);
            }}
            className={cn(
              GHOST,
              publish.isPending && 'cursor-not-allowed opacity-50',
            )}
          >
            Discard draft
          </Button>
        )}
        <Tooltip content={why} side="bottom" arrow>
          <Button
            aria-disabled={why !== null || publish.isPending || undefined}
            onClick={() => {
              if (!why && !publish.isPending) publish.mutate();
            }}
            className={cn(
              'bg-primary-strong hover:bg-primary-strong/90',
              why && 'cursor-not-allowed opacity-50 hover:bg-primary-strong',
              publish.isPending && 'cursor-progress',
            )}
          >
            {publish.isPending && (
              <Loader
                aria-hidden
                className="size-4 animate-spin motion-reduce:animate-none"
              />
            )}
            {publish.isPending ? 'Publishing…' : `Publish v${version.version}`}
          </Button>
        </Tooltip>
      </div>
      {failure && (
        <p
          role="alert"
          className="flex max-w-lg flex-wrap items-center justify-end gap-x-2 gap-y-1 text-right text-xs text-danger-strong"
        >
          {failure}
          {gone && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-sm font-medium text-primary-strong outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            >
              Reload
            </button>
          )}
        </p>
      )}
      {published && (
        <DiscardDialog
          open={discarding}
          template={template}
          version={version}
          fallback={published.version}
          draft={draft}
          showToast={showToast}
          onClose={() => {
            setDiscarding(false);
            discardButton.current?.focus();
          }}
        />
      )}
    </div>
  );
}

/** Asks before the draft goes for good (PLAN §7); the page then reads the version left. */
function DiscardDialog({
  open,
  template,
  version,
  fallback,
  draft,
  showToast,
  onClose,
}: {
  open: boolean;
  template: Template;
  version: TemplateVersion;
  fallback: number;
  draft: Draft;
  showToast: (toast: ToastInput) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const discard = useMutation({
    mutationFn: async () => {
      // Nothing may write to the draft once it's gone.
      await draft.save.stop();
      return api(`/template-versions/${version.id}`, templateSchema, {
        method: 'DELETE',
      });
    },
    onSuccess: (next) => {
      queryClient.setQueryData(['template', next.id], next);
      queryClient.removeQueries({
        queryKey: ['template-version', version.id],
      });
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
      showToast({
        status: 'success',
        title: `Draft v${version.version} discarded`,
        description: `New onboardings still start from v${fallback}.`,
      });
    },
    // Still there: it saves again.
    onError: (error) => {
      if (!elsewhere(error)) draft.save.resume();
    },
  });
  const close = () => {
    discard.reset();
    onClose();
  };
  // The modal re-runs its focus effect whenever this callback changes, so it stays one function.
  const keep = useRef(close);
  useEffect(() => {
    keep.current = close;
  });
  const onOpenChange = useCallback((open: boolean) => {
    if (!open) keep.current();
  }, []);
  const title = `Discard draft v${version.version}?`;
  return (
    <CenterMorphModal open={open} onOpenChange={onOpenChange}>
      <CenterMorphModalContent
        ariaLabel={title}
        closeButtonLabel="Close"
        // The drawer's scrim (Foundations).
        backdropClassName="bg-black/40"
      >
        <div className="flex flex-col gap-4.5 p-6">
          <h2 className="pr-10 text-xl leading-7 font-semibold tracking-tight">
            {title}
          </h2>
          <p className="-mt-3 text-[13px] leading-5 text-muted-foreground">
            Its changes are deleted, and {template.name} stays at v{fallback}.
            No onboarding uses a draft, so none changes.
          </p>
          {discard.error && (
            <Notice
              variant="destructive"
              title={`Couldn't discard draft v${version.version}`}
              text={
                elsewhere(discard.error)
                  ? 'It was published, discarded or archived elsewhere. Reload the page to see it now.'
                  : messageOf(discard.error)
              }
            />
          )}
          <div className="flex flex-col gap-2">
            <Button
              size="lg"
              aria-disabled={discard.isPending || undefined}
              onClick={() => {
                if (!discard.isPending) discard.mutate();
              }}
              className={TINTED_DANGER}
            >
              {discard.isPending ? 'Discarding…' : 'Discard draft'}
            </Button>
            <Button variant="secondary" className={GHOST} onClick={close}>
              Keep draft
            </Button>
          </div>
        </div>
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}

/**
 * The template's own actions, whichever tab is open: Archive, which is final (PLAN §8). Off
 * while a publish is on its way, so the two never cross.
 */
function TemplateMenu({
  template,
  draft,
  busy = false,
  showToast,
}: {
  template: Template;
  draft?: Draft;
  busy?: boolean;
  showToast: (toast: ToastInput) => void;
}) {
  const [archiving, setArchiving] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  if (template.archivedAt) return null;
  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger openOnClick disabled={busy}>
          <button
            ref={more}
            type="button"
            aria-label={`More actions for ${template.name}`}
            aria-disabled={busy || undefined}
            className={MENU_BUTTON}
          >
            <More aria-hidden className="size-4.5" />
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent ariaLabel="Template actions">
          <ContextMenuLabel className="max-w-64 truncate">
            {template.name}
          </ContextMenuLabel>
          <ContextMenuItem
            tone="destructive"
            className="text-danger-strong"
            onSelect={() => setArchiving(true)}
          >
            <ArchiveBox aria-hidden className="size-3.5" />
            Archive template…
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <ArchiveDialog
        open={archiving}
        template={template}
        draft={draft}
        showToast={showToast}
        onClose={() => {
          setArchiving(false);
          more.current?.focus();
        }}
      />
    </>
  );
}

// The only 409 archiving gives: someone archived it first.
const archivedElsewhere = (error: unknown) =>
  error instanceof ApiError && error.status === 409;

/**
 * Asks before archiving, with what it means for the onboardings on the template (BR-T12):
 * running ones carry on, drafts need another template. A draft version stays as last saved.
 */
function ArchiveDialog({
  open,
  template,
  draft,
  showToast,
  onClose,
}: {
  open: boolean;
  template: Template;
  draft?: Draft;
  showToast: (toast: ToastInput) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  // A draft onboarding has no version yet, so only the list knows it; HR sees them all (§9).
  const onboardings = useQuery({
    queryKey: ['onboardings'],
    queryFn: () => api('/onboardings', onboardingSummarySchema.array()),
    enabled: open,
  });
  const archive = useMutation({
    mutationFn: async () => {
      if (draft) {
        // The draft keeps the last change if it can be saved; nothing writes to it after.
        await draft.save.flush().catch(() => undefined);
        await draft.save.stop();
      }
      return api(`/templates/${template.id}/archive`, templateSchema, {
        method: 'POST',
      });
    },
    onSuccess: (archived) => {
      queryClient.setQueryData(['template', archived.id], archived);
      // Where onboardings start or get activated, it now reads as archived.
      for (const queryKey of [['templates'], ['onboardings'], ['dashboard']]) {
        void queryClient.invalidateQueries({ queryKey });
      }
      showToast({
        status: 'success',
        title: `${archived.name} archived`,
        description:
          'No new onboarding can start from it. Running ones carry on.',
      });
    },
    // Not archived after all: the draft saves again.
    onError: (error) => {
      if (!archivedElsewhere(error)) draft?.save.resume();
    },
  });
  const close = () => {
    archive.reset();
    onClose();
  };
  // The modal re-runs its focus effect whenever this callback changes, so it stays one function.
  const keep = useRef(close);
  useEffect(() => {
    keep.current = close;
  });
  const onOpenChange = useCallback((open: boolean) => {
    if (!open) keep.current();
  }, []);
  const running = template.versions.reduce((sum, v) => sum + v.running, 0);
  const published = template.versions.some((v) => v.status === 'PUBLISHED');
  const kept = template.versions.find((v) => v.status === 'DRAFT');
  const drafts = onboardings.data?.filter(
    (onboarding) =>
      onboarding.status === 'DRAFT' && onboarding.template.id === template.id,
  );
  const title = `Archive ${template.name}?`;
  return (
    <CenterMorphModal open={open} onOpenChange={onOpenChange}>
      <CenterMorphModalContent
        ariaLabel={title}
        closeButtonLabel="Close"
        // The drawer's scrim (Foundations).
        backdropClassName="bg-black/40"
      >
        <div className="flex flex-col gap-4.5 p-6">
          <h2 className="pr-10 text-xl leading-7 font-semibold tracking-tight">
            {title}
          </h2>
          <p className="-mt-3 text-[13px] leading-5 text-muted-foreground">
            No new onboarding can start from it, and it can&apos;t be edited or
            published again. This can&apos;t be undone.
          </p>
          <ul className="flex flex-col gap-2 text-[13px] leading-5">
            <Point>
              {!published
                ? 'It was never published, so no onboarding uses it.'
                : running === 0
                  ? 'No onboarding is running on it.'
                  : running === 1
                    ? '1 running onboarding carries on, on the version it started with.'
                    : `${running} running onboardings carry on, each on the version it started with.`}
            </Point>
            {kept && (
              <Point>
                Draft v{kept.version} is kept as it was last saved
                {published && ", and can't be published"}.
              </Point>
            )}
            {/* No onboarding ever started from a template never published (FR-07). */}
            {published &&
              (onboardings.isPending ? (
                <li className="flex gap-2.5 text-muted-foreground">
                  <Loader
                    aria-hidden
                    className="mt-0.75 size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
                  />
                  Looking for draft onboardings that use it…
                </li>
              ) : !drafts ? (
                <Point>Couldn&apos;t check for draft onboardings.</Point>
              ) : drafts.length === 1 ? (
                <Point>
                  <span className="font-medium">
                    {drafts[0].employee.fullName}&apos;s
                  </span>{' '}
                  draft onboarding needs another template before it can be
                  activated.
                </Point>
              ) : (
                drafts.length > 1 && (
                  <Point>
                    {capitalized(inWords(drafts.length))} draft onboardings need
                    another template before they can be activated.
                  </Point>
                )
              ))}
          </ul>
          {archive.error && (
            <Notice
              variant="destructive"
              title={`Couldn't archive ${template.name}`}
              text={
                archivedElsewhere(archive.error)
                  ? 'It was archived elsewhere. Reload the page to see it now.'
                  : messageOf(archive.error)
              }
            />
          )}
          <div className="flex flex-col gap-2">
            <Button
              size="lg"
              aria-disabled={archive.isPending || undefined}
              onClick={() => {
                if (!archive.isPending) archive.mutate();
              }}
              className={TINTED_DANGER}
            >
              {archive.isPending ? 'Archiving…' : 'Archive template'}
            </Button>
            <Button variant="secondary" className={GHOST} onClick={close}>
              Keep template
            </Button>
          </div>
        </div>
      </CenterMorphModalContent>
    </CenterMorphModal>
  );
}

function Point({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden
        className="mt-1.75 size-1.5 shrink-0 rounded-full bg-muted-foreground"
      />
      <span>{children}</span>
    </li>
  );
}

/** The template, and what the version on screen means for new onboardings. */
function Header({
  template,
  shown,
  timeZone,
  action,
  menu,
}: {
  template: Template;
  shown: VersionSummary;
  timeZone: string;
  action: ReactNode;
  menu: ReactNode;
}) {
  const { archivedAt, versions } = template;
  const published = newestPublished(template);
  const draft = versions.find(({ status }) => status === 'DRAFT');
  // The published version right after this one, newest first.
  const successor = versions
    .filter((v) => v.status === 'PUBLISHED' && v.version > shown.version)
    .at(-1);
  const note = archivedAt
    ? `Archived ${formatDateIn(archivedAt, timeZone)}. Onboardings already running carry on; no new ones start from it.`
    : shown.status === 'DRAFT'
      ? published
        ? `Edited from v${published.version}. Running onboardings keep the version they started with.`
        : 'Not published yet, so no onboarding can start from it.'
      : successor
        ? `Replaced by v${successor.version}. Onboardings that started on it keep it.`
        : draft
          ? `New onboardings start from this version until draft v${draft.version} is published.`
          : `New onboardings start from this version. Editing makes draft v${versions[0].version + 1}, which nothing uses until it's published.`;
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-3xl font-semibold tracking-tight">
            {template.name}
          </h1>
          <AnimatedBadge size="md" status="neutral" showIcon={false}>
            {archivedAt
              ? 'Archived'
              : `${shown.status === 'DRAFT' ? 'Draft' : 'Published'} v${shown.version}`}
          </AnimatedBadge>
        </div>
        <span className="text-muted-foreground">{note}</span>
      </div>
      <div className="flex items-start gap-2">
        {action}
        {menu}
      </div>
    </div>
  );
}

/** One tab per version, newest first (FR-06), with what runs on it, else what it started. */
function VersionTabs({
  template,
  value,
  onChange,
}: {
  template: Template;
  value: string;
  onChange: (id: string) => void;
}) {
  if (template.versions.length < 2) return null;
  const current = currentOf(template);
  return (
    <Tabs
      value={value}
      onValueChange={onChange}
      className="max-w-full self-start"
    >
      <TabsList aria-label="Versions">
        {template.versions.map((v) => (
          <TabsTrigger
            key={v.id}
            value={v.id}
            // White on the stronger blue (ADR 009).
            indicatorClassName="bg-primary-strong"
            className="gap-1"
          >
            v{v.version}
            {v.status === 'DRAFT' ? ' · draft' : v === current && ' · current'}
            {(v.running > 0 || v.used > 0) && (
              <span className="text-xs">
                · {v.running > 0 ? `${v.running} running` : `${v.used} used`}
              </span>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

/**
 * A version as it stands: its phases, and the picked task's details beside them or in a drawer,
 * or on the Graph tab what waits for what (FR-23).
 */
function ReadOnly({
  template,
  versionId,
  view,
  onView,
}: {
  template: Template;
  versionId: string;
  view: View;
  onView: (view: View) => void;
}) {
  const { data: version, error } = useQuery({
    queryKey: ['template-version', versionId],
    queryFn: () =>
      api(`/template-versions/${versionId}`, templateVersionSchema),
  });
  const wide = useWide();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const tabs = useId();
  if (!version) return error ? <LoadFailed /> : null;
  const { tasks } = version.definition;
  if (tasks.length === 0) {
    return (
      <EmptyState
        title="Nothing in this version"
        description="It has no phases or tasks."
      />
    );
  }
  const selected = tasks.find(({ key }) => key === selectedKey) ?? tasks[0];
  const current = wide || drawerOpen ? selected.key : undefined;
  // Edit copies the current version into the next draft (BR-T02).
  const next =
    versionId === currentOf(template)?.id &&
    !template.versions.some(({ status }) => status === 'DRAFT')
      ? template.versions[0].version + 1
      : undefined;
  const pick = (key: string) => {
    setSelectedKey(key);
    if (!wide) setDrawerOpen(true);
  };
  return (
    <>
      <ViewTabs id={tabs} value={view} onChange={onView} />
      {view === 'graph' ? (
        <TemplateGraph
          definition={version.definition}
          panel={tabPanel(tabs, 'graph')}
        />
      ) : (
        <div
          className="flex flex-wrap items-start gap-5"
          {...tabPanel(tabs, 'phases')}
        >
          <div className="flex min-w-0 flex-[1_1_420px] flex-col">
            <Phases
              definition={version.definition}
              row={(task) => (
                <button
                  type="button"
                  data-pick={task.key}
                  aria-current={task.key === current || undefined}
                  onClick={() => pick(task.key)}
                  className={cn(
                    ROW,
                    task.key === current &&
                      'border-primary ring-1 ring-primary',
                  )}
                >
                  <TaskSummary task={task} selected={task.key === current} />
                </button>
              )}
            />
          </div>
          {wide && <TaskFacts task={selected} version={version} next={next} />}
        </div>
      )}
      {!wide && (
        <Drawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          ariaLabel={titleOf(selected)}
          className="w-120 max-w-full"
        >
          <TaskFacts
            drawer
            task={selected}
            version={version}
            next={next}
            actions={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close"
                onClick={() => setDrawerOpen(false)}
                className="size-9 shrink-0 rounded-full bg-foreground/4 hover:bg-foreground/9 active:bg-foreground/12"
              >
                <X aria-hidden className="size-4" />
              </Button>
            }
          />
        </Drawer>
      )}
    </>
  );
}

/** A task as the version has it: what the editor's panel holds, as text. */
function TaskFacts({
  task,
  version,
  next,
  drawer = false,
  actions,
}: {
  task: TaskDef;
  version: TemplateVersion;
  // The draft Edit would start, when it can.
  next: number | undefined;
  drawer?: boolean;
  actions?: ReactNode;
}) {
  const id = useId();
  const { phases, tasks } = version.definition;
  const titled = (key: string | undefined) => {
    const task = tasks.find((t) => t.key === key);
    return task && titleOf(task);
  };
  const opens = task.availableOffsetDays;
  const due = task.dueOffsetDays;
  // An approval also waits for the document it reviews, as the editor says.
  const reviewed = task.type === 'APPROVAL' ? titled(task.reviews) : undefined;
  const fact = 'flex min-w-0 flex-col gap-1';
  const wide = 'col-span-2';
  const term = 'px-1 text-[13px] leading-[18px] text-muted-foreground';
  const value = 'px-1 leading-[22px]';
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className={
        drawer
          ? 'flex h-full min-h-0 flex-col'
          : 'flex min-w-0 flex-[999_1_480px] flex-col gap-5 rounded-2xl border border-border p-6'
      }
    >
      <div
        className={cn(
          'flex items-start gap-2',
          drawer && 'border-b border-border px-6 py-4 max-sm:px-4',
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2
            id={`${id}-heading`}
            className={cn(
              'font-semibold',
              drawer ? 'text-lg leading-6' : 'text-[15px] leading-[21px]',
            )}
          >
            {titleOf(task)}
          </h2>
          <p className="text-[13px] leading-5 text-muted-foreground">
            {phases.find(({ key }) => key === task.phase)?.name} · v
            {version.version}, read only
          </p>
        </div>
        {actions}
      </div>
      <div
        className={cn(
          'flex flex-col gap-5 text-sm',
          drawer && 'min-h-0 flex-1 overflow-y-auto px-6 py-5 max-sm:px-4',
        )}
      >
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4.5">
          <div className={fact}>
            <dt className={term}>Type</dt>
            <dd className={value}>
              {TASK_TYPES[task.type].label} ·{' '}
              {TYPE_HINTS[task.type].toLowerCase()}
            </dd>
          </div>
          <div className={fact}>
            <dt className={term}>Who does it</dt>
            <dd className={value}>{ASSIGNEES[assigneeKey(task.assignee)]}</dd>
          </div>
          {task.type === 'APPROVAL' && (
            <div className={cn(fact, wide)}>
              <dt className={term}>Document it reviews</dt>
              <dd className={value}>{titled(task.reviews) ?? 'None'}</dd>
            </div>
          )}
          <div className={fact}>
            <dt className={term}>Opens</dt>
            <dd className={value}>
              <span className="font-mono">{signed(opens)}</span> ·{' '}
              {dayOf(opens)}
              {opens === 0 && ', the start date'}
            </dd>
          </div>
          <div className={fact}>
            <dt className={term}>Due</dt>
            <dd className={value}>
              <span className="font-mono">{signed(due)}</span> · end of{' '}
              {due < 0 && 'the day, '}
              {dayOf(due)}
            </dd>
          </div>
          <div className={cn(fact, wide)}>
            <dt className={term}>Waits for</dt>
            {task.dependsOn.length > 0 ? (
              <dd className="flex flex-col gap-1.5 px-1 pt-0.5">
                <span className="flex flex-wrap gap-1.5">
                  {task.dependsOn.map((key) => (
                    <span
                      key={key}
                      className="inline-flex h-7 items-center rounded-lg bg-card px-2 text-xs font-medium"
                    >
                      {titled(key)}
                    </span>
                  ))}
                </span>
                {reviewed && (
                  <span className="text-xs leading-4 text-muted-foreground">
                    Also waits for {reviewed}, the document it reviews.
                  </span>
                )}
              </dd>
            ) : (
              <dd className={cn(value, !reviewed && 'text-muted-foreground')}>
                {reviewed ? `${reviewed}, the document it reviews` : 'Nothing'}
              </dd>
            )}
          </div>
          {task.description?.trim() && (
            <div className={cn(fact, wide)}>
              <dt className={term}>Instructions</dt>
              <dd className={value}>
                <Steps text={task.description} />
              </dd>
            </div>
          )}
        </dl>
        {version.status === 'PUBLISHED' && (
          <p className="text-[13px] leading-5 text-muted-foreground">
            A published version never changes.
            {next && ` Edit starts draft v${next} from it.`}
          </p>
        )}
      </div>
    </section>
  );
}

/** Starts the next draft from the newest published version (BR-T02); the page then edits it. */
function EditButton({ templateId }: { templateId: string }) {
  const queryClient = useQueryClient();
  const start = useMutation({
    mutationFn: () =>
      api(`/templates/${templateId}/versions`, templateVersionSchema, {
        method: 'POST',
      }),
    onSuccess: (draft) => {
      queryClient.setQueryData(['template-version', draft.id], draft);
      // The list the page reads, with the draft first, so the editor opens without a refetch.
      queryClient.setQueryData<Template>(
        ['template', templateId],
        (template) =>
          template && {
            ...template,
            versions: [
              {
                id: draft.id,
                version: draft.version,
                status: draft.status,
                publishedAt: draft.publishedAt,
                running: 0,
                used: 0,
              },
              ...template.versions,
            ],
          },
      );
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    // Someone else started a draft or archived the template: show what is there now.
    onError: () =>
      queryClient.invalidateQueries({ queryKey: ['template', templateId] }),
  });
  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        onClick={() => start.mutate()}
        disabled={start.isPending}
        className="bg-primary-strong hover:bg-primary-strong/90"
      >
        <Edit aria-hidden className="size-4" />
        Edit
      </Button>
      {start.error && (
        <p role="alert" className="text-xs text-danger-strong">
          {messageOf(start.error)}
        </p>
      )}
    </div>
  );
}

function LoadFailed() {
  return (
    <Alert variant="destructive" className="text-danger-strong">
      <AlertIcon />
      <AlertContent>
        <AlertTitle>Couldn&apos;t load the template</AlertTitle>
        <AlertDescription>Reload the page to try again.</AlertDescription>
      </AlertContent>
    </Alert>
  );
}
