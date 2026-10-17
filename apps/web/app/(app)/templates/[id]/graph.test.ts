import {
  type TaskDef,
  type TemplateDefinition,
  validateTemplate,
} from '@joinpath/core';
import { describe, expect, it } from 'vitest';
import { CARD, layoutGraph } from '../../../../components/graph-layout';
import { graphTasks, linksToFix } from './graph';

const task = (key: string, fields: Partial<TaskDef> = {}): TaskDef => ({
  key,
  phase: 'before',
  title: key,
  type: 'CHECKLIST',
  assignee: { kind: 'ROLE', role: 'IT' },
  availableOffsetDays: -7,
  dueOffsetDays: -3,
  dependsOn: [],
  ...fields,
});
const template = (...tasks: TaskDef[]): TemplateDefinition => ({
  phases: [
    { key: 'before', name: 'Before day 1' },
    { key: 'day-1', name: 'Day 1' },
  ],
  tasks,
});
// As in Engineering Onboarding: the approval names its document only as what it reviews.
const upload = task('upload-id', {
  type: 'DOCUMENT',
  assignee: { kind: 'NEW_HIRE' },
});
const review = task('review-id', {
  type: 'APPROVAL',
  assignee: { kind: 'ROLE', role: 'HR' },
  reviews: 'upload-id',
});
const links = (def: TemplateDefinition) =>
  layoutGraph(graphTasks(def))
    .arrows.map(({ from, to }) => `${from}>${to}`)
    .sort();

describe('template graph', () => {
  it('FR-23: draws an arrow from a document to the approval that reviews it, once', () => {
    const create = task('create-accounts', {
      dependsOn: ['review-id', 'create-accounts', 'gone'],
    });
    for (const approval of [review, { ...review, dependsOn: ['upload-id'] }]) {
      expect(links(template(upload, approval, create))).toEqual([
        'review-id>create-accounts',
        'upload-id>review-id',
      ]);
    }
  });

  it('BR-T05: lays out a loop inside a phase, the link that closes it below the cards, both links to fix', () => {
    const def = template(
      task('prepare-laptop', { dependsOn: ['create-accounts'] }),
      task('create-accounts', { dependsOn: ['prepare-laptop'] }),
      task('set-up-dev-env', {
        phase: 'day-1',
        dependsOn: ['prepare-laptop', 'create-accounts'],
      }),
    );
    const { cards, arrows } = layoutGraph(graphTasks(def));
    const bottom =
      Math.max(...[...cards.values()].map(([, y]) => y)) + CARD.height;
    const below = arrows.filter(({ points }) =>
      points.some(([, y]) => y > bottom),
    );

    expect(arrows).toHaveLength(4);
    expect(below.map(({ from, to }) => `${from}>${to}`)).toEqual([
      'prepare-laptop>create-accounts',
    ]);
    expect(linksToFix(def, validateTemplate(def))).toEqual(
      new Set([
        'create-accounts>prepare-laptop',
        'prepare-laptop>create-accounts',
      ]),
    );
    // A loop through what an approval reviews: that arrow is one to fix too.
    const through = template({ ...upload, dependsOn: ['review-id'] }, review);
    expect(linksToFix(through, validateTemplate(through))).toEqual(
      new Set(['review-id>upload-id', 'upload-id>review-id']),
    );
  });

  it('BR-T09: marks a wait for a document its approval reviews, not the approval’s own', () => {
    const def = template(
      upload,
      review,
      task('create-accounts', { dependsOn: ['upload-id'] }),
    );
    const issues = validateTemplate(def);

    expect(issues.map(({ rule }) => rule)).toEqual(['BR-T09']);
    expect(linksToFix(def, issues)).toEqual(
      new Set(['upload-id>create-accounts']),
    );
  });
});
