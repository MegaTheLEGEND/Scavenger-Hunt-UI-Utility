import './globals.css';

export const metadata = {
  title: 'Scavenger Hunt — Mission Briefing',
  description: 'Official challenge board and rules for the scavenger hunt.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
