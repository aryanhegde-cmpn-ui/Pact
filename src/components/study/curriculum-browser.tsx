'use client';

import { useState } from 'react';

import type { BrowserBlock, BrowserTopic } from '@/lib/curriculum/service';
import type { TopicStatus } from '@/lib/schemas/curriculum';

/**
 * The curriculum, block then module then topic.
 *
 * The hierarchy is modelled now rather than flattened for convenience: this
 * view becomes a course-style layout later, and adding a level to a component
 * tree that other things already depend on is the expensive version of the
 * change.
 */
const NEXT_STATUS: Record<TopicStatus, TopicStatus> = {
  'not-started': 'in-progress',
  'in-progress': 'done',
  done: 'needs-revision',
  // Back to the start: a topic marked weak and then re-studied is done again.
  'needs-revision': 'done',
};

const STATUS_LABEL: Record<TopicStatus, string> = {
  'not-started': 'not started',
  'in-progress': 'in progress',
  done: 'done',
  'needs-revision': 'needs revision',
};

export function CurriculumBrowser({
  initial,
  resources,
}: {
  initial: BrowserBlock[];
  resources: { name: string; type: string; use: string; link: string; howToUse: string }[];
}): React.JSX.Element {
  const [blocks, setBlocks] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function advance(topic: BrowserTopic) {
    const status = NEXT_STATUS[topic.status];
    setBusy(topic.stableKey);
    try {
      const response = await fetch('/api/curriculum/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stableKey: topic.stableKey, status }),
        cache: 'no-store',
      });
      if (!response.ok) return;

      setBlocks((current) =>
        current.map((block) => ({
          ...block,
          modules: block.modules.map((module) => ({
            ...module,
            topics: module.topics.map((row) =>
              row.stableKey === topic.stableKey ? { ...row, status } : row,
            ),
          })),
        })),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-xl">
      {blocks.map((block) => (
        <section key={`${block.blockId}-${block.category}`}>
          <h2 className="text-base font-medium">
            {block.category}
            <span className="text-text/40 ml-xs text-xs">{block.blockId}</span>
          </h2>

          <div className="mt-sm flex flex-col gap-md">
            {block.modules.map((module) => (
              <div key={module.module} className="border-edge bg-surface rounded-lg border p-md">
                <h3 className="text-text/70 text-sm font-medium">{module.module}</h3>

                <ul className="mt-xs flex flex-col gap-xs">
                  {module.topics.map((topic) => (
                    <li key={topic.stableKey} className="flex items-start justify-between gap-sm">
                      <div className="min-w-0">
                        <p className="text-sm">
                          {topic.topic}
                          <span className="text-text/40 ml-xs text-xs">{topic.priority}</span>
                        </p>
                        {topic.subTopic ? (
                          <p className="text-text/50 text-xs">{topic.subTopic}</p>
                        ) : null}
                        <p className="text-text/40 mt-2xs text-xs">
                          {topic.targetLabel}
                          {topic.needsReview ? ' · target not parsed' : ''}
                        </p>
                        {topic.link ? (
                          <a
                            href={topic.link}
                            target="_blank"
                            rel="noreferrer"
                            className="text-text/50 hover:text-signal text-xs underline"
                          >
                            {topic.resourceName}
                          </a>
                        ) : null}
                      </div>

                      <button
                        type="button"
                        disabled={busy === topic.stableKey}
                        onClick={() => void advance(topic)}
                        className="border-edge hover:border-signal min-h-11 shrink-0 rounded border px-sm text-xs transition-colors"
                      >
                        {STATUS_LABEL[topic.status]}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section>
        <h2 className="text-base font-medium">Resources</h2>
        {/*
          Deliberately no counts, no percentages and no progress of any kind.
          The workbook says twice that these are pools rather than courses, and
          each row's own instruction says the same. A test enforces it.
        */}
        <ul className="mt-sm flex flex-col gap-xs">
          {resources.map((resource) => (
            <li key={resource.name} className="border-edge bg-surface rounded-lg border p-sm">
              <p className="text-sm">
                {resource.link ? (
                  <a
                    href={resource.link}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-signal underline"
                  >
                    {resource.name}
                  </a>
                ) : (
                  resource.name
                )}
                <span className="text-text/40 ml-xs text-xs">{resource.type}</span>
              </p>
              <p className="text-text/50 mt-2xs text-xs">{resource.howToUse}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
