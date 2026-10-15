'use client';

import {
  type Department,
  departmentNameSchema,
  departmentSchema,
  type Employee,
  employeeSchema,
  type Role,
} from '@joinpath/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Plus } from 'reicon-react';
import { Avatar, tintOf } from '@/components/avatar';
import { cn } from '@/components/beui/lib/utils';
import {
  AnimatedToastStack,
  type ToastInput,
  useAnimatedToastStack,
} from '@/components/beui/motion/animated-toast-stack';
import { Button } from '@/components/beui/motion/button/base';
import { Input } from '@/components/beui/motion/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/beui/motion/tabs';
import { EmptyState } from '@/components/empty-state';
import { Notice } from '@/components/notice';
import { Table, Td, Th, THead, Tr } from '@/components/table';
import { api, ApiError } from '@/lib/api';

export const employeesQuery = {
  queryKey: ['employees'],
  queryFn: () => api('/employees', employeeSchema.array()),
};
export const departmentsQuery = {
  queryKey: ['departments'],
  queryFn: () => api('/departments', departmentSchema.array()),
};

/**
 * A toast for this page to show when the employee form comes back to it: a page's toasts
 * go when the page does.
 */
export const pendingToast: { current?: ToastInput } = {};

const ROLE_LABEL: Record<Role, string> = {
  HR: 'HR',
  IT: 'IT',
  MEMBER: 'Member',
};

/** What a refused write says, or what to do when the API was out of reach. */
export const messageOf = (error: unknown) =>
  error instanceof ApiError
    ? error.message
    : 'Check your connection and try again.';

type Tab = 'people' | 'departments';

export function Employees() {
  const [tab, setTab] = useState<Tab>('people');
  const { toasts, showToast, dismissToast } = useAnimatedToastStack();
  const people = useQuery(employeesQuery);
  const departments = useQuery(departmentsQuery);

  useEffect(() => {
    if (!pendingToast.current) return;
    showToast(pendingToast.current);
    pendingToast.current = undefined;
  }, [showToast]);

  let page = null;
  // A failed refetch keeps the rows already shown.
  if (people.data && departments.data) {
    page = (
      <div className="flex flex-col gap-5">
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as Tab)}
          variant="underline"
        >
          <TabsList aria-label="Employees">
            <TabsTrigger value="people" className="gap-1.5">
              People
              <span className="text-muted-foreground">
                {people.data.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value="departments" className="gap-1.5">
              Departments
              <span className="text-muted-foreground">
                {departments.data.length}
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {tab === 'people' ? (
          <People people={people.data} />
        ) : (
          <Departments
            departments={departments.data}
            people={people.data}
            onSaved={showToast}
          />
        )}
      </div>
    );
  } else if (people.error || departments.error) {
    page = (
      <Notice
        variant="destructive"
        title="Couldn't load the people"
        text="Reload the page to try again."
      />
    );
  }

  return (
    <>
      {page}
      <AnimatedToastStack toasts={toasts} onDismiss={dismissToast} fixed />
    </>
  );
}

function People({ people }: { people: Employee[] }) {
  if (people.length === 0) {
    return (
      <EmptyState
        title="No employees yet"
        description="People you add show up here."
      />
    );
  }
  const none = <span className="text-muted-foreground">—</span>;
  return (
    <Table className="min-w-215">
      <THead>
        <Th>Person</Th>
        <Th>Email</Th>
        <Th>Department</Th>
        <Th>Manager</Th>
        <Th>Account</Th>
      </THead>
      <tbody>
        {people.map((employee) => (
          // The name's link stretches over the row, so the whole row opens the record.
          <Tr key={employee.id} className="relative active:bg-foreground/8">
            <Td>
              <div className="flex items-center gap-3">
                <Avatar
                  name={employee.fullName}
                  className={cn(
                    'size-8',
                    tintOf(employee.id, employee.user?.role),
                  )}
                />
                <span className="flex flex-col">
                  <Link
                    href={`/employees/${employee.id}`}
                    className="font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-primary focus-visible:after:ring-inset"
                  >
                    {employee.fullName}
                  </Link>
                  <span className="text-[13px] leading-5 text-muted-foreground">
                    {employee.jobTitle}
                  </span>
                </span>
              </div>
            </Td>
            <Td className="font-mono text-xs text-muted-foreground">
              {employee.email}
            </Td>
            <Td className="whitespace-nowrap">
              {employee.department?.name ?? none}
            </Td>
            <Td className="whitespace-nowrap">
              {employee.manager?.fullName ?? none}
            </Td>
            <Td
              className={cn(
                'whitespace-nowrap',
                employee.user?.status !== 'ACTIVE' && 'text-muted-foreground',
              )}
            >
              {!employee.user
                ? 'No account yet'
                : employee.user.status === 'DISABLED'
                  ? 'Disabled'
                  : ROLE_LABEL[employee.user.role]}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

const LINK =
  'rounded-sm text-[13px] font-medium text-primary-strong outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary';
const PRIMARY = 'bg-primary-strong hover:bg-primary-strong/90';

// Added and renamed, never removed (PLAN §7).
function Departments({
  departments,
  people,
  onSaved,
}: {
  departments: Department[];
  people: Employee[];
  onSaved: (toast: ToastInput) => void;
}) {
  const [renaming, setRenaming] = useState<Department>();
  return (
    <div className="flex max-w-180 flex-col gap-3">
      <Table className="min-w-140">
        <THead>
          <Th>Department</Th>
          <Th className="w-30">People</Th>
          <Th className="w-px">
            <span className="sr-only">Actions</span>
          </Th>
        </THead>
        <tbody>
          {departments.map((department) => {
            if (department.id === renaming?.id) {
              return (
                <Tr
                  key={department.id}
                  className="bg-primary/5 hover:bg-primary/5"
                >
                  <Td colSpan={3} className="py-2.5 pr-3">
                    <NameForm
                      label={`New name for ${department.name}`}
                      initial={department.name}
                      submit="Save"
                      send={(name) =>
                        api(`/departments/${department.id}`, departmentSchema, {
                          method: 'PATCH',
                          body: { name },
                        })
                      }
                      onSaved={(saved) => {
                        setRenaming(undefined);
                        if (saved.name !== department.name) {
                          onSaved({
                            status: 'success',
                            title: 'Department renamed',
                            description: `${department.name} is now ${saved.name}.`,
                          });
                        }
                      }}
                      onCancel={() => setRenaming(undefined)}
                    />
                  </Td>
                </Tr>
              );
            }
            const count = people.filter(
              (employee) => employee.department?.id === department.id,
            ).length;
            return (
              <Tr key={department.id}>
                <Td className="font-medium">{department.name}</Td>
                <Td className="text-muted-foreground">
                  {count} {count === 1 ? 'person' : 'people'}
                </Td>
                <Td className="py-1.5 pr-3 text-right">
                  <button
                    type="button"
                    aria-label={`Rename ${department.name}`}
                    onClick={() => setRenaming(department)}
                    className={cn(LINK, 'h-8 px-2')}
                  >
                    Rename
                  </button>
                </Td>
              </Tr>
            );
          })}
          <tr className="border-t border-foreground/6">
            <Td colSpan={3} className="py-2.5 pr-3">
              <NameForm
                label="New department"
                initial=""
                submit="Add department"
                send={(name) =>
                  api('/departments', departmentSchema, {
                    method: 'POST',
                    body: { name },
                  })
                }
                onSaved={(saved) =>
                  onSaved({
                    status: 'success',
                    title: 'Department added',
                    description: saved.name,
                  })
                }
              />
            </Td>
          </tr>
        </tbody>
      </Table>
      <p className="px-1 text-[13px] leading-5 text-muted-foreground">
        Departments can be renamed but not removed. Pick one for each person on
        their record.
      </p>
    </div>
  );
}

// One name, checked as the API checks it. Renaming has Cancel (and Esc); adding starts over.
function NameForm({
  label,
  initial,
  submit,
  send,
  onSaved,
  onCancel,
}: {
  label: string;
  initial: string;
  submit: string;
  send: (name: string) => Promise<Department>;
  onSaved: (department: Department) => void;
  onCancel?: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const renaming = !!onCancel;
  // Rename turns the row into this field: focus follows.
  useEffect(() => {
    if (renaming) input.current?.focus();
  }, [renaming]);
  const save = useMutation({
    mutationFn: send,
    onSuccess: (department) => {
      // People show their department's name.
      void queryClient.invalidateQueries({ queryKey: ['departments'] });
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
      setName(initial);
      onSaved(department);
    },
    onError: (failure) => setError(messageOf(failure)),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = departmentNameSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setError(undefined);
    save.mutate(parsed.data.name);
  }

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="flex flex-wrap items-start gap-2"
    >
      <Input
        ref={input}
        aria-label={label}
        placeholder={onCancel ? undefined : label}
        value={name}
        onChange={(value) => {
          setName(value);
          setError(undefined);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel?.();
        }}
        error={error}
        className="min-w-0 flex-[1_1_260px]"
        // A field on the renamed row's tint.
        classNames={{
          field: 'bg-background',
          errorMessage: 'text-danger-strong',
        }}
      />
      {onCancel && (
        <Button
          type="button"
          variant="ghost"
          className="mt-0.5"
          onClick={onCancel}
        >
          Cancel
        </Button>
      )}
      <Button
        type="submit"
        variant={onCancel ? 'primary' : 'secondary'}
        disabled={save.isPending}
        className={cn('mt-0.5', onCancel && PRIMARY)}
      >
        {!onCancel && <Plus className="size-4" />}
        {submit}
      </Button>
    </form>
  );
}
