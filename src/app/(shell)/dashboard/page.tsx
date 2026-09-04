import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Dashboard' };

/** Main interactive surface. Empty until auth and the Google Tasks sync exist. */
export default function DashboardPage() {
  return (
    <div className="py-xl">
      <h1 className="text-2xl leading-tight font-semibold tracking-tight">Dashboard</h1>
      <p className="text-text/60 mt-sm text-sm">What needs doing now, and what is being avoided.</p>

      <div className="border-edge bg-surface mt-lg rounded-lg border p-lg">
        <p className="text-text/50 text-sm">No data source connected yet.</p>
      </div>
    </div>
  );
}
