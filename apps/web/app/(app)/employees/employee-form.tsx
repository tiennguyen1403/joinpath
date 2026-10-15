'use client';

import {
  type CreateEmployee,
  createEmployeeSchema,
  type Department,
  type Employee,
  employeeSchema,
} from '@joinpath/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Lock } from 'reicon-react';
import { Avatar, tintOf } from '@/components/avatar';
import { cn } from '@/components/beui/lib/utils';
import { Button, ButtonLink } from '@/components/beui/motion/button/base';
import { Input } from '@/components/beui/motion/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/beui/motion/select';
import { EmptyState } from '@/components/empty-state';
import { Notice } from '@/components/notice';
import { api, ApiError } from '@/lib/api';
import { usePageCrumb } from '../app-shell';
import {
  departmentsQuery,
  employeesQuery,
  messageOf,
  pendingToast,
} from './employees';

// The select's value for no department or no manager: ids are UUIDs.
const NONE = 'none';
const ERROR = { errorMessage: 'text-danger-strong' };

/** HR's form for someone new, or for the record of `id` (FR-03). */
export function EmployeeForm({
  id,
  emailDomain,
}: {
  id?: string;
  // BR-D04: in a sandbox, only the part before the @ is typed.
  emailDomain: string | null;
}) {
  const people = useQuery(employeesQuery);
  const departments = useQuery(departmentsQuery);
  const employee = id
    ? people.data?.find((person) => person.id === id)
    : undefined;
  usePageCrumb(id ? employee?.fullName : 'New employee');

  if (!people.data || !departments.data) {
    return people.error || departments.error ? (
      <Notice
        variant="destructive"
        title="Couldn't load the people"
        text="Reload the page to try again."
      />
    ) : null;
  }
  if (id && !employee) {
    return (
      <EmptyState
        title="Employee not found"
        description="Check the link, or pick them from Employees."
      />
    );
  }
  return (
    <Fields
      employee={employee}
      people={people.data}
      departments={departments.data}
      emailDomain={emailDomain}
    />
  );
}

type Field = 'fullName' | 'email' | 'jobTitle';

function Fields({
  employee,
  people,
  departments,
  emailDomain,
}: {
  employee: Employee | undefined;
  people: Employee[];
  departments: Department[];
  emailDomain: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  // Their sign-in: changing it is account management, which HR has no screen for (PLAN §3).
  const locked = !!employee?.user;
  const [fullName, setFullName] = useState(employee?.fullName ?? '');
  const [email, setEmail] = useState(
    !employee
      ? ''
      : emailDomain
        ? employee.email.split('@')[0]
        : employee.email,
  );
  const [jobTitle, setJobTitle] = useState(employee?.jobTitle ?? '');
  const [departmentId, setDepartmentId] = useState(
    employee?.department?.id ?? NONE,
  );
  const [managerId, setManagerId] = useState(employee?.manager?.id ?? NONE);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  const save = useMutation({
    mutationFn: (body: CreateEmployee) =>
      employee
        ? api(`/employees/${employee.id}`, employeeSchema, {
            method: 'PATCH',
            body,
          })
        : api('/employees', employeeSchema, { method: 'POST', body }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['employees'] });
      pendingToast.current = employee
        ? {
            status: 'success',
            title: 'Changes saved',
            description: saved.fullName,
          }
        : {
            status: 'success',
            title: 'Employee added',
            description: `${saved.fullName} can now be picked for an onboarding.`,
          };
      router.push('/employees');
    },
    // Every 409 here is about the email: someone else has it, or it's a sign-in.
    onError: (failure) => {
      if (failure instanceof ApiError && failure.status === 409) {
        setErrors({ email: failure.message });
      }
    },
  });
  const failed =
    save.error &&
    !(save.error instanceof ApiError && save.error.status === 409);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = email.trim();
    const parsed = createEmployeeSchema.safeParse({
      fullName,
      email: locked
        ? employee!.email
        : emailDomain
          ? `${typed}@${emailDomain}`
          : typed,
      jobTitle,
      departmentId: departmentId === NONE ? null : departmentId,
      managerId: managerId === NONE ? null : managerId,
    });
    if (!parsed.success) {
      // The first problem of each field.
      const found: Partial<Record<Field, string>> = {};
      for (const { path, message } of parsed.error.issues) {
        found[path[0] as Field] ??= message;
      }
      if (found.email && emailDomain) {
        // The seed's pattern as an example, as long as it makes a valid address: Dung Le → dung.le.
        const example = fullName.trim().toLowerCase().split(/\s+/).join('.');
        found.email = !typed
          ? 'Enter the part before @'
          : /^[a-z0-9]+(\.[a-z0-9]+)*$/.test(example)
            ? `Enter a valid email, like ${example}`
            : found.email;
      }
      setErrors(found);
      return;
    }
    setErrors({});
    save.mutate(parsed.data);
  }

  const edit =
    (field: Field, set: (value: string) => void) => (value: string) => {
      set(value);
      setErrors((current) => ({ ...current, [field]: undefined }));
    };
  const department = departments.find(({ id }) => id === departmentId);
  const unfit = employee ? withReports(employee.id, people) : new Set<string>();
  const managers = people.filter(({ id }) => !unfit.has(id));
  const manager = people.find(({ id }) => id === managerId);

  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">
          {employee ? employee.fullName : 'New employee'}
        </h1>
        <p className="leading-[23px] text-muted-foreground">
          {employee
            ? [employee.jobTitle, employee.department?.name]
                .filter(Boolean)
                .join(' · ')
            : 'Add someone before you start their onboarding.'}
        </p>
      </div>
      <form
        noValidate
        onSubmit={onSubmit}
        aria-label={employee ? `${employee.fullName}'s record` : 'New employee'}
        className="flex max-w-160 flex-col gap-5 rounded-2xl border border-border p-6"
      >
        <Input
          label="Full name"
          value={fullName}
          onChange={edit('fullName', setFullName)}
          autoComplete="off"
          error={errors.fullName}
          classNames={ERROR}
        />
        {locked ? (
          <div className="flex flex-col gap-1.5">
            <Input
              label="Work email"
              value={employee!.email}
              readOnly
              leftIcon={<Lock />}
              aria-describedby="email-locked"
              classNames={{ field: 'bg-card' }}
            />
            <p
              id="email-locked"
              className="px-1 text-xs leading-4 text-muted-foreground"
            >
              {employee!.fullName} signs in with this email, so it can&apos;t be
              changed here.
            </p>
          </div>
        ) : emailDomain ? (
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="employee-email"
              className="px-1 text-sm font-medium"
            >
              Work email
            </label>
            <div className="flex flex-wrap items-start gap-x-2.5">
              <Input
                id="employee-email"
                value={email}
                onChange={edit('email', setEmail)}
                autoComplete="off"
                spellCheck={false}
                // The input names its error itself, unless told otherwise.
                aria-describedby={[
                  errors.email && 'employee-email-error',
                  'employee-email-domain',
                ]
                  .filter(Boolean)
                  .join(' ')}
                error={errors.email}
                className="min-w-0 flex-[1_1_220px]"
                classNames={ERROR}
              />
              <span
                id="employee-email-domain"
                className="flex h-11 items-center font-mono text-[13px] text-muted-foreground"
              >
                @{emailDomain}
              </span>
            </div>
          </div>
        ) : (
          <Input
            label="Work email"
            type="email"
            value={email}
            onChange={edit('email', setEmail)}
            autoComplete="off"
            error={errors.email}
            classNames={ERROR}
          />
        )}
        <Input
          label="Job title"
          value={jobTitle}
          onChange={edit('jobTitle', setJobTitle)}
          autoComplete="off"
          error={errors.jobTitle}
          classNames={ERROR}
        />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] items-start gap-x-4 gap-y-5">
          <Picker label="Department">
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger className={TRIGGER}>
                {department ? (
                  department.name
                ) : (
                  <span className="text-muted-foreground">No department</span>
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No department</SelectItem>
                {departments.map(({ id, name }) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Picker>
          <Picker
            label="Manager"
            hint={
              employee
                ? "Changing it won't move tasks in an onboarding that's already running."
                : "Gets the manager's tasks in their onboarding, and can see it."
            }
          >
            <Select value={managerId} onValueChange={setManagerId}>
              <SelectTrigger className={TRIGGER}>
                {manager ? (
                  <span className="flex items-center gap-2">
                    <Avatar
                      name={manager.fullName}
                      className={cn(
                        'size-5.5 text-[10px]',
                        tintOf(manager.id, manager.user?.role),
                      )}
                    />
                    {manager.fullName}
                  </span>
                ) : (
                  <span className="text-muted-foreground">No manager</span>
                )}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No manager</SelectItem>
                {managers.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <Avatar
                        name={person.fullName}
                        className={cn(
                          'size-5.5 text-[10px]',
                          tintOf(person.id, person.user?.role),
                        )}
                      />
                      {/* The name stays whole; the job title gives way. */}
                      <span className="shrink-0 text-foreground">
                        {person.fullName}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-right text-xs">
                        {person.jobTitle}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Picker>
        </div>
        <div className="h-px bg-border" />
        {failed && (
          <Notice
            variant="destructive"
            title={
              employee
                ? "Couldn't save the changes"
                : "Couldn't add the employee"
            }
            text={messageOf(save.error)}
          />
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <ButtonLink href="/employees" variant="secondary">
            Cancel
          </ButtonLink>
          <Button
            type="submit"
            disabled={save.isPending}
            className="bg-primary-strong hover:bg-primary-strong/90"
          >
            {employee ? 'Save changes' : 'Add employee'}
          </Button>
        </div>
      </form>
    </>
  );
}

// Inputs are 44px tall; the canvas draws selects to match, with the stronger border.
const TRIGGER = 'h-11 border-foreground/12';

function Picker({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-2 px-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">Optional</span>
      </span>
      {children}
      {hint && (
        <p className="px-1 text-xs leading-4 text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/** They and everyone who reports to them, directly or not: none can be their manager. */
function withReports(id: string, people: Employee[]) {
  const below = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const { id: person, manager } of people) {
      if (manager && below.has(manager.id) && !below.has(person)) {
        below.add(person);
        grew = true;
      }
    }
  }
  return below;
}
