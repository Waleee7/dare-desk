import type { Metadata } from 'next';
import { Fraunces } from 'next/font/google';
import './globals.css';

// Fraunces = a characterful modern serif for the brand/identity (the Ledger DNA).
// Body stays system-sans for instant, neutral readability (the Broker DNA).
const display = Fraunces({
  subsets: ['latin'],
  weight: ['600', '700'],
  style: ['normal'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: 'DARE Desk',
  description: 'Live signals, positions, charts, performance, and news.',
};

// Apply the saved light/dark mode BEFORE first paint — no flash.
const modeScript = `try{var m=localStorage.getItem('desk-mode')||'light';document.documentElement.dataset.mode=m;}catch(e){document.documentElement.dataset.mode='light';}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: modeScript }} />
      </head>
      <body className={display.variable}>{children}</body>
    </html>
  );
}
