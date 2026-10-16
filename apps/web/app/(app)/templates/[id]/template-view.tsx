'use client';

import {
  type Template,
  type TemplateVersion,
  templateSchema,
  templateVersionSchema,
} from '@joinpath/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Edit } from 'reicon-react';
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
} from '@/components/beui/motion/alert';
import { AnimatedBadge } from '@/components/beui/motion/animated-badge';
import { Button } from '@/components/beui/motion/button/base';
import { EmptyState } from '@/components/empty-state';
import { api, ApiError, messageOf } from '@/lib/api';
import { formatDateIn } from '@/lib/format';
import { usePageCrumb } from '../../app-shell';
import { Editor } from './editor';
import { Phases, TaskSummary } from './phases';

/**
 * A template opened from the list (FR-04). Its draft is edited here; without one, the version
 * new onboardings get is shown and Edit starts the next draft (BR-T02). Archived, it only reads.
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
  // Versions come newest first, with at most one draft (BR-T02).
  const draft = template.archivedAt
    ? undefined
    : template.versions.find(({ status }) => status === 'DRAFT');
  const shown =
    draft ??
    template.versions.find(({ status }) => status === 'PUBLISHED') ??
    template.versions[0];
  return (
    <Version
      key={shown.id}
      template={template}
      versionId={shown.id}
      timeZone={timeZone}
    />
  );
}

function Version({
  template,
  versionId,
  timeZone,
}: {
  template: Template;
  versionId: string;
  timeZone: string;
}) {
  const { data: version, error } = useQuery({
    queryKey: ['template-version', versionId],
    queryFn: () =>
      api(`/template-versions/${versionId}`, templateVersionSchema),
  });
  if (!version) return error ? <LoadFailed /> : null;

  const editing = version.status === 'DRAFT' && !template.archivedAt;
  return (
    <>
      <Header
        template={template}
        version={version}
        timeZone={timeZone}
        action={
          !editing &&
          !template.archivedAt && <EditButton templateId={template.id} />
        }
      />
      {editing ? (
        <Editor version={version} />
      ) : version.definition.tasks.length === 0 ? (
        <EmptyState
          title="Nothing in this version"
          description="It has no phases or tasks."
        />
      ) : (
        <Phases
          definition={version.definition}
          row={(task) => (
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-background p-3">
              <TaskSummary task={task} />
            </div>
          )}
        />
      )}
    </>
  );
}

function Header({
  template,
  version,
  timeZone,
  action,
}: {
  template: Template;
  version: TemplateVersion;
  timeZone: string;
  action: ReactNode;
}) {
  const published = template.versions.find(
    ({ status }) => status === 'PUBLISHED',
  );
  const note = template.archivedAt
    ? `Archived ${formatDateIn(template.archivedAt, timeZone)}. Onboardings already running carry on; no new ones start from it.`
    : version.status === 'PUBLISHED'
      ? `New onboardings start from this version. Editing makes draft v${template.versions[0].version + 1}, which nothing uses until it's published.`
      : published
        ? `Edited from v${published.version}. Running onboardings keep the version they started with.`
        : 'Not published yet, so no onboarding can start from it.';
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-3xl font-semibold tracking-tight">
            {template.name}
          </h1>
          <AnimatedBadge size="md" status="neutral" showIcon={false}>
            {template.archivedAt
              ? 'Archived'
              : `${version.status === 'DRAFT' ? 'Draft' : 'Published'} v${version.version}`}
          </AnimatedBadge>
        </div>
        <span className="text-muted-foreground">{note}</span>
      </div>
      {action}
    </div>
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
