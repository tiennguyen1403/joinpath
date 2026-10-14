import { requireMe } from '@/lib/session';
import { AppShell } from './app-shell';

// Signed-in pages. The check here is for the UI only; the API guards every request itself.
export default async function AppLayout({ children }: LayoutProps<'/'>) {
  return <AppShell me={await requireMe()}>{children}</AppShell>;
}
