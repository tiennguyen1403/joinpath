import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/logo';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in · Joinpath' };

export default function LoginPage() {
  return (
    <main className="flex flex-col items-center gap-7 px-4 pt-20 pb-24 text-[15px] leading-6">
      <Link href="/" aria-label="Joinpath home">
        <Logo large />
      </Link>
      <LoginForm />
      <p className="max-w-100 text-center text-sm leading-[23px] text-muted-foreground">
        Starting a new job? Open the invitation email from your HR team to set
        your password.
      </p>
    </main>
  );
}
