import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "NBA Matchup Model",
  description: "Daily team-level NBA projections: scores, spreads, and totals.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="container">
            <Link href="/" className="brand">
              NBA Matchup Model
            </Link>
          </div>
        </header>
        <main className="container">{children}</main>
        <footer className="container muted small footer">
          Projections from team box scores (hoopR / ESPN). Weights: YTD 40 · L3 25 · H/A 30 · Prior 5.
        </footer>
      </body>
    </html>
  );
}
