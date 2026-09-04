import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Study' };

/** Study planner surface. */
export default function StudyPage() {
  return (
    <div className="py-xl">
      <h1 className="text-2xl leading-tight font-semibold tracking-tight">Study</h1>
      <p className="text-text/60 mt-sm text-sm">Sessions, coverage and what is falling behind.</p>

      <div className="border-edge bg-surface mt-lg rounded-lg border p-lg">
        <p className="text-text/50 text-sm">No syllabus configured yet.</p>
      </div>
    </div>
  );
}
