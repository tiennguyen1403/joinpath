'use client';

import { type Template, templateSchema } from '@joinpath/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, Plus } from 'reicon-react';
import { AnimatedBadge } from '@/components/beui/motion/animated-badge';
import { Button } from '@/components/beui/motion/button/base';
import {
  CenterMorphModal,
  CenterMorphModalContent,
} from '@/components/beui/motion/center-morph-modal';
import { Input } from '@/components/beui/motion/input';
import { EmptyState } from '@/components/empty-state';
import { Notice } from '@/components/notice';
import { Table, Td, Th, THead, Tr } from '@/components/table';
import { api, messageOf } from '@/lib/api';
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

/** Names a new template in a dialog; created, it opens as draft v1 in the editor (FR-04). */
export function NewTemplateButton() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [missing, setMissing] = useState(false);
  const descriptionId = useId();
  const hintId = useId();
  const create = useMutation({
    mutationFn: (body: { name: string; description: string }) =>
      api('/templates', templateSchema, { method: 'POST', body }),
    onSuccess: (template) => {
      queryClient.setQueryData(['template', template.id], template);
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
      router.push(`/templates/${template.id}`);
    },
  });
  const close = () => {
    setOpen(false);
    setName('');
    setDescription('');
    setMissing(false);
    create.reset();
    button.current?.focus();
  };
  // The modal re-runs its focus effect whenever this callback changes, so it stays one function.
  const closing = useRef(close);
  useEffect(() => {
    closing.current = close;
  });
  const onOpenChange = useCallback((next: boolean) => {
    if (!next) closing.current();
  }, []);

  return (
    <>
      <Button
        ref={button}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="bg-primary-strong hover:bg-primary-strong/90"
      >
        <Plus aria-hidden className="size-4" />
        New template
      </Button>
      <CenterMorphModal open={open} onOpenChange={onOpenChange}>
        <CenterMorphModalContent
          ariaLabel="New template"
          closeButtonLabel="Close"
          // The drawer's scrim (Foundations).
          backdropClassName="bg-black/40"
        >
          <form
            className="flex flex-col gap-4.5 p-6"
            onSubmit={(event) => {
              event.preventDefault();
              const named = name.trim();
              if (named) {
                create.mutate({ name: named, description: description.trim() });
              } else {
                setMissing(true);
              }
            }}
          >
            <h2 className="pr-10 text-xl leading-7 font-semibold tracking-tight">
              New template
            </h2>
            <p className="-mt-3 text-[13px] leading-5 text-muted-foreground">
              It starts as draft v1. Add its phases and tasks, then publish it.
            </p>
            <Input
              label="Name"
              value={name}
              onChange={(value) => {
                setName(value);
                setMissing(false);
              }}
              maxLength={80}
              autoComplete="off"
              disabled={create.isPending}
              error={missing && 'Give the template a name.'}
              classNames={{ errorMessage: 'text-danger-strong' }}
            />
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor={descriptionId}
                className="px-1 text-sm font-medium"
              >
                Description{' '}
                <span className="font-normal text-muted-foreground">
                  · optional
                </span>
              </label>
              <textarea
                id={descriptionId}
                rows={3}
                maxLength={500}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={create.isPending}
                aria-describedby={hintId}
                className="resize-y rounded-2xl border border-border bg-transparent px-4 py-2.5 text-sm leading-[22px] outline-none transition-colors focus:border-foreground/40 focus:ring-2 focus:ring-ring/40"
              />
              <p
                id={hintId}
                className="px-1 text-xs leading-4 text-muted-foreground"
              >
                Shown under its name in Templates.
              </p>
            </div>
            {create.error && (
              <Notice
                variant="destructive"
                title="Couldn't create the template"
                text={messageOf(create.error)}
              />
            )}
            <Button
              type="submit"
              size="lg"
              disabled={create.isPending}
              className="bg-primary-strong hover:bg-primary-strong/90"
            >
              {create.isPending ? 'Creating…' : 'Create template'}
            </Button>
          </form>
        </CenterMorphModalContent>
      </CenterMorphModal>
    </>
  );
}

function TemplateRow({
  template: { id, name, description, archivedAt, versions },
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
    // The name's link stretches over the row, so the whole row opens the template.
    <Tr className="relative align-top active:bg-foreground/8">
      <Td className="py-3.5">
        <div className="flex flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <Link
              href={`/templates/${id}`}
              className="font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-primary focus-visible:after:ring-inset"
            >
              {name}
            </Link>
            {(archivedAt || !newest) && (
              // Positioned, which would lift it over the row's link.
              <span className="pointer-events-none">
                <AnimatedBadge size="sm" status="neutral" showIcon={false}>
                  {archivedAt ? 'Archived' : 'Not published'}
                </AnimatedBadge>
              </span>
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
    </Tr>
  );
}
