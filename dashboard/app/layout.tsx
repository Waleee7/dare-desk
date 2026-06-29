import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DARE Desk — Trading Dashboard',
  description: 'Live signals, trade history, performance, journal, and news.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
