import type { Metadata } from 'next';
import { AcceptInvite } from './accept-invite';

export const metadata: Metadata = { title: 'Accept invitation · Joinpath' };

// Public: the link's token is the only key (PLAN §8). Outside the app shell, like /login.
export default function InvitePage() {
  return <AcceptInvite />;
}
