import type { Metadata } from 'next';
import { APP_NAME } from '@joinpath/core';

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Employee onboarding platform',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
