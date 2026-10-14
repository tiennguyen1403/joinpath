import { redirect } from 'next/navigation';
import { homeFor } from '@/lib/nav';
import { getMe } from '@/lib/session';

// The landing page arrives in M5.3; until then / only sends people where they belong.
export default async function Home() {
  const me = await getMe();
  redirect(me ? homeFor(me.role) : '/login');
}
