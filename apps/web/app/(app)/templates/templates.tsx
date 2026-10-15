'use client';

import { type Template, templateSchema } from '@joinpath/core';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'reicon-react';
import { AnimatedBadge } from '@/components/beui/motion/animated-badge';
import { EmptyState } from '@/components/empty-state';
import { Notice } from '@/components/notice';
import { Table, Td, Th, THead } from '@/components/table';
import { api } from '@/lib/api';
import { formatDateIn } from '@/lib/format';

export function Templates({ timeZone }: { timeZone: string }) {
  // The wizard's template step asks with the same key, so each fills the other's cache.
  const { data, error } = useQuery({
    queryKey: ['templates'],
    queryFn: () => api('/templates', templateSchema.array()),
  });
  if (!data) {
    return error ? (
      <Notice
        variant="destructive"
        title="Couldn't load the templates"
        text="Reload the page to try again."
      />
    ) : null;
  }
  if (data.length === 0) {
    return (
      <EmptyState
        title="No templates yet"
        description="Templates hold the phases and tasks an onboarding starts from."
      />
    );
  }
  // By name, as the API sends them, with the archived ones last.
  const templates = data.toSorted(
    (a, b) => Number(a.archivedAt !== null) - Number(b.archivedAt !== null),
  );
  return (
    <Table className="min-w-190">
      <THead>
        <Th className="w-[55%]">Template</Th>
        <Th>Versions, newest first</Th>
      </THead>
      <tbody>
        {templates.map((template) => (
          <TemplateRow
            key={template.id}
            template={template}
            timeZone={timeZone}
          />
        ))}
      </tbody>
    </Table>
  );
}

function TemplateRow({
  template: { name, description, archivedAt, versions },
  timeZone,
}: {
  template: Template;
  timeZone: string;
}) {
  // Versions come newest first, so this is the one a new onboarding gets (BR-A03), unless
  // the template is archived (BR-T12).
  const newest = versions.find(({ publishedAt }) => publishedAt);
  const current = archivedAt ? undefined : newest;
  const note = archivedAt
    ? `Archived ${formatDateIn(archivedAt, timeZone)}. Onboardings already running carry on; no new ones start from it.`
    : !newest &&
      'No onboarding can start from it until a version is published.';
  const line = 'text-[13px] leading-5 text-muted-foreground';
  return (
    // Not the shared Tr: a row opens nothing until the editor, so it does not hover.
    <tr className="border-t border-foreground/4 align-top">
      <Td className="py-3.5">
        <div className="flex flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{name}</span>
            {(archivedAt || !newest) && (
              <AnimatedBadge size="sm" status="neutral" showIcon={false}>
                {archivedAt ? 'Archived' : 'Not published'}
              </AnimatedBadge>
            )}
          </span>
          {description && <span className={line}>{description}</span>}
          {note && <span className={line}>{note}</span>}
        </div>
      </Td>
      <Td className="py-3.5">
        <ol aria-label={`${name} versions`} className="flex flex-col gap-1.5">
          {versions.map((version) => (
            <li
              key={version.id}
              className="flex flex-wrap items-center gap-x-2.5 gap-y-1"
            >
              <span className="min-w-6 font-medium">v{version.version}</span>
              <span className="text-muted-foreground">
                {version.publishedAt
                  ? `Published ${formatDateIn(version.publishedAt, timeZone)}`
                  : 'Draft, not published yet'}
              </span>
              {version === current && (
                <span className="inline-flex items-center gap-1 text-[13px] font-medium text-primary-strong">
                  <Check className="size-3.5" />
                  Current
                </span>
              )}
            </li>
          ))}
        </ol>
      </Td>
    </tr>
  );
}
