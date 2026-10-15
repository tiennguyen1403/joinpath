import { describe, expect, it } from 'vitest';
import {
  templateDefinitionSchema,
  validateTemplate,
  type TaskDef,
} from './template.js';
import {
  HR,
  IT,
  MANAGER,
  engineering,
  task,
  template,
} from './test/fixtures.js';

describe('validateTemplate', () => {
  it('BR-T04–T10 all pass for Engineering Onboarding v2 from the canvas', () => {
    expect(validateTemplate(engineering)).toEqual([]);
  });

  it('BR-T04 needs at least one phase and one task', () => {
    expect(validateTemplate({ phases: [], tasks: [] })).toEqual([
      { rule: 'BR-T04', taskKeys: [], message: 'Add at least one phase.' },
      { rule: 'BR-T04', taskKeys: [], message: 'Add at least one task.' },
    ]);
  });

  it('BR-T04 keys are unique, and so are task titles whatever their case', () => {
    const issues = validateTemplate({
      phases: [
        { key: 'day-1', name: 'Day 1' },
        { key: 'day-1', name: 'Day one' },
      ],
      tasks: [
        task('a'),
        task('a', { title: 'Another a' }),
        task('b', { title: 'Prepare laptop' }),
        task('c', { title: 'prepare laptop' }),
      ],
    });
    expect(issues).toEqual([
      {
        rule: 'BR-T04',
        taskKeys: [],
        message: 'Several phases use the key day-1. Give each one its own key.',
      },
      {
        rule: 'BR-T04',
        taskKeys: ['a'],
        message: 'Several tasks use the key a. Give each one its own key.',
      },
      {
        rule: 'BR-T04',
        taskKeys: ['b', 'c'],
        message:
          'Several tasks are called Prepare laptop. Give each one its own title.',
      },
    ]);
  });

  it('BR-T04 phase, dependsOn and reviews point at parts that exist, and no task waits for itself', () => {
    const issues = validateTemplate(
      template(
        task('a', { phase: 'week-9' }),
        task('b', { dependsOn: ['b', 'ghost'] }),
        task('c', { type: 'APPROVAL', assignee: HR, reviews: 'missing' }),
      ),
    );
    expect(issues).toEqual([
      {
        rule: 'BR-T04',
        taskKeys: ['a'],
        message: "a is in phase week-9, which isn't in this template.",
      },
      {
        rule: 'BR-T04',
        taskKeys: ['b'],
        message: 'b waits for itself. Remove that link.',
      },
      {
        rule: 'BR-T04',
        taskKeys: ['b'],
        message: "b waits for ghost, which isn't a task in this template.",
      },
      {
        rule: 'BR-T04',
        taskKeys: ['c'],
        message: "c reviews missing, which isn't a task in this template.",
      },
    ]);
  });

  it('BR-T05 reports a loop once and flags every task in it (draft v3 on the canvas)', () => {
    const v3 = {
      ...engineering,
      tasks: engineering.tasks.map((t) =>
        t.key === 'set-up-dev-env'
          ? { ...t, dependsOn: [...t.dependsOn, 'ship-first-pr'] }
          : t,
      ),
    };
    expect(validateTemplate(v3)).toEqual([
      {
        rule: 'BR-T05',
        taskKeys: ['set-up-dev-env', 'ship-first-pr'],
        message:
          'Set up dev environment waits for Ship your first pull request, which already waits for Set up dev environment. Neither could ever open. Remove one of the two links.',
      },
    ]);
  });

  it('BR-T05 counts the reviewed document as a link, and leaves tasks after the loop alone', () => {
    const issues = validateTemplate(
      template(
        task('doc', { type: 'DOCUMENT', dependsOn: ['prep'] }),
        task('review', { type: 'APPROVAL', assignee: HR, reviews: 'doc' }),
        task('prep', { assignee: IT, dependsOn: ['review'] }),
        task('after', { dependsOn: ['prep'] }),
      ),
    );
    expect(issues).toEqual([
      {
        rule: 'BR-T05',
        taskKeys: ['doc', 'review', 'prep'],
        message:
          'doc, review, and prep wait for each other in a loop, so none of them could ever open. Remove one of the links.',
      },
    ]);
  });

  it('BR-T06 a task opens on or before its due date', () => {
    expect(
      validateTemplate(
        template(task('a', { availableOffsetDays: 3, dueOffsetDays: 2 })),
      ),
    ).toEqual([
      { rule: 'BR-T06', taskKeys: ['a'], message: 'a is due before it opens.' },
    ]);
  });

  it('BR-T07 checks the whole chain a task waits for, not only its direct prerequisites', () => {
    // b's own dates fit c, and a's fit b, yet a can't be done before c opens on +5.
    const issues = validateTemplate(
      template(
        task('a', { dueOffsetDays: 1, dependsOn: ['b'] }),
        task('b', { dueOffsetDays: 5, dependsOn: ['c'] }),
        task('c', { availableOffsetDays: 5, dueOffsetDays: 5 }),
      ),
    );
    expect(issues).toEqual([
      {
        rule: 'BR-T07',
        taskKeys: ['a'],
        message: 'a waits for c, which only opens after a is due.',
      },
    ]);
  });

  it('BR-T07 an approval is not due before the document it reviews opens', () => {
    const issues = validateTemplate(
      template(
        task('doc', {
          type: 'DOCUMENT',
          availableOffsetDays: -5,
          dueOffsetDays: -5,
        }),
        task('review', {
          type: 'APPROVAL',
          assignee: HR,
          availableOffsetDays: -14,
          dueOffsetDays: -10,
          reviews: 'doc',
        }),
      ),
    );
    expect(issues).toEqual([
      {
        rule: 'BR-T07',
        taskKeys: ['review'],
        message: 'review waits for doc, which only opens after review is due.',
      },
    ]);
  });

  it('BR-T08 an approval reviews exactly one document, and only approvals review', () => {
    const issues = validateTemplate(
      template(
        task('doc', { type: 'DOCUMENT' }),
        task('note'),
        task('no-target', { type: 'APPROVAL', assignee: HR }),
        task('wrong-target', {
          type: 'APPROVAL',
          assignee: HR,
          reviews: 'note',
        }),
        task('not-approval', { reviews: 'doc' }),
      ),
    );
    expect(issues).toEqual([
      {
        rule: 'BR-T08',
        taskKeys: ['no-target'],
        message: 'Pick the document no-target reviews.',
      },
      {
        rule: 'BR-T08',
        taskKeys: ['wrong-target'],
        message: "wrong-target reviews note, which isn't a document.",
      },
      {
        rule: 'BR-T08',
        taskKeys: ['not-approval'],
        message:
          "not-approval isn't an approval, so it can't review a document.",
      },
    ]);
  });

  it('BR-T08 a document gets at most one approval', () => {
    const issues = validateTemplate(
      template(
        task('doc', { type: 'DOCUMENT' }),
        task('hr-review', { type: 'APPROVAL', assignee: HR, reviews: 'doc' }),
        task('it-review', { type: 'APPROVAL', assignee: IT, reviews: 'doc' }),
      ),
    );
    expect(issues).toEqual([
      {
        rule: 'BR-T08',
        taskKeys: ['hr-review', 'it-review'],
        message:
          'hr-review and it-review review doc, but a document gets one approval.',
      },
    ]);
  });

  it('BR-T09 only its approval waits for a reviewed document; other tasks wait for the approval', () => {
    const issues = validateTemplate(
      template(
        task('upload', { title: 'Upload ID documents', type: 'DOCUMENT' }),
        // Listing the reviewed document in dependsOn as well is fine.
        task('review', {
          title: 'Review ID documents',
          type: 'APPROVAL',
          assignee: HR,
          reviews: 'upload',
          dependsOn: ['upload'],
        }),
        task('accounts', {
          title: 'Create work accounts',
          assignee: IT,
          dependsOn: ['upload'],
        }),
        task('laptop', { assignee: IT, dependsOn: ['review'] }),
        // Nobody reviews this one, so anyone may wait for it.
        task('form', { type: 'DOCUMENT' }),
        task('desk', { assignee: IT, dependsOn: ['form'] }),
      ),
    );
    expect(issues).toEqual([
      {
        rule: 'BR-T09',
        taskKeys: ['accounts'],
        message:
          'Create work accounts waits for Upload ID documents, which Review ID documents reviews. Make it wait for Review ID documents instead.',
      },
    ]);
  });

  it('BR-T10 an approval does not go to the new hire', () => {
    const issues = validateTemplate(
      template(
        task('doc', { type: 'DOCUMENT', assignee: MANAGER }),
        task('review', { type: 'APPROVAL', reviews: 'doc' }),
      ),
    );
    expect(issues).toEqual([
      {
        rule: 'BR-T10',
        taskKeys: ['review'],
        message: "review is an approval, so it can't go to the new hire.",
      },
    ]);
  });
});

describe('templateDefinitionSchema', () => {
  it('BR-T11 assigns work by rule only: new hire, direct manager, HR or IT', () => {
    const accepts = (assignee: unknown) =>
      templateDefinitionSchema.safeParse({
        ...template(),
        tasks: [{ ...task('a'), assignee }],
      }).success;
    expect(accepts({ kind: 'NEW_HIRE' })).toBe(true);
    expect(accepts({ kind: 'DIRECT_MANAGER' })).toBe(true);
    expect(accepts({ kind: 'ROLE', role: 'IT' })).toBe(true);
    expect(accepts({ kind: 'ROLE', role: 'MEMBER' })).toBe(false);
    expect(accepts({ kind: 'EMPLOYEE', employeeId: 'lan-pham' })).toBe(false);
  });

  it('checks each field on its own and keeps a valid definition as it is', () => {
    const accepts = (fields: Partial<TaskDef>) =>
      templateDefinitionSchema.safeParse(template(task('a', fields))).success;
    expect(accepts({})).toBe(true);
    expect(accepts({ key: 'Set up' })).toBe(false);
    expect(accepts({ title: '   ' })).toBe(false);
    expect(accepts({ dueOffsetDays: 1.5 })).toBe(false);
    expect(accepts({ dueOffsetDays: 366 })).toBe(false);
    expect(templateDefinitionSchema.parse(engineering)).toEqual(engineering);
  });
});
