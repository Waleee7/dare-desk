import type { Metadata } from 'next';
import { Space_Grotesk } from 'next/font/google';
import './globals.css';

const display = Space_Grotesk({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-display' });

export const metadata: Metadata = {
  title: 'DARE Desk — Trading Dashboard',
  description: 'Live signals, positions, charts, performance, and news.',
};

// Apply the saved theme BEFORE first paint — no flash of the default theme.
const themeScript = `try{var t=localStorage.getItem('desk-theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={display.variable}>{children}</body>
    </html>
  );
}
