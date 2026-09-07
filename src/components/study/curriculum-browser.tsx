'use client';

import { useMemo, useState } from 'react';

import type { BrowserBlock, BrowserTopic } from '@/lib/curriculum/service';
import type { TopicStatus } from '@/lib/schemas/curriculum';

/**
 * The curriculum, block then module then topic.
 *
 * The hierarchy is modelled now rather than flattened for convenience: this
 * view becomes a course-style layout later, and adding a level to a component
 * tree that other things already depend on is the expensive version of the
 * change.
 *
 * ---------------------------------------------------------------------------
 * MODULES ARE CLOSED UNTIL ASKED FOR.
 * ---------------------------------------------------------------------------
 * Every topic expanded is fine at a dozen and useless at sixty: the real sheet
 * rendered eleven thousand pixels of page on a phone, which is not a browser,
 * it is a dump. Nothing was findable without scrolling past everything.
 *
 * So: modules collapsed by default with their state on the summary line, and
 * a filter that searches topic, sub-topic and module together and opens
 * whatever matched. Marking a topic never closes anything -- the module you
 * were working in stays where you left it.
 * ---------------------------------------------------------------------------
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

  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<Set<string>>(new Set());

  const needle = query.trim().toLowerCase();

  /**
   * Filtered on every keystroke over a list this size, which is cheap and
   * stays cheap: sixty topics is nothing, and paging it would hide the one
   * result someone is looking for behind a page number.
   */
  const shown = useMemo(() => {
    if (!needle) return blocks;

    return blocks
      .map((block) => ({
        ...block,
        modules: block.modules
          .map((module) => ({
            ...module,
            topics: module.module.toLowerCase().includes(needle)
              ? module.topics
              : module.topics.filter((topic) =>
                  `${topic.topic} ${topic.subTopic ?? ''}`.toLowerCase().includes(needle),
                ),
          }))
          .filter((module) => module.topics.length > 0),
      }))
      .filter((block) => block.modules.length > 0);
  }, [blocks, needle]);

  const total = blocks.reduce(
    (sum, block) => sum + block.modules.reduce((count, module) => count + module.topics.length, 0),
    0,
  );
  const found = shown.reduce(
    (sum, block) => sum + block.modules.reduce((count, module) => count + module.topics.length, 0),
    0,
  );

  return (
    <div className="flex flex-col gap-xl">
      <div className="flex flex-col gap-2xs">
        <label htmlFor="curriculum-filter" className="text-text/40 text-xs">
          Filter
        </label>
        <input
          id="curriculum-filter"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="topic, sub-topic or module"
          className="border-edge bg-surface min-h-11 rounded border px-md text-sm sm:max-w-[24rem]"
        />
        {needle ? (
          <p className="text-text/40 text-xs">
            <span className="figures">{found}</span> of <span className="figures">{total}</span>{' '}
            topics
          </p>
        ) : null}
      </div>

      {shown.map((block) => (
        <section key={`${block.blockId}-${block.category}`}>
          <h2 className="text-base font-medium">
            {block.category}
            <span className="text-text/40 ml-xs text-xs">{block.blockId}</span>
          </h2>

          {/* Two columns from 1024 up. A module card is a narrow thing and a
              single column of them at 1440 is a phone layout on a desktop. */}
          <div className="mt-sm grid grid-cols-1 gap-md lg:grid-cols-2 lg:items-start">
            {block.modules.map((module) => {
              const key = `${block.blockId}-${module.module}`;
              // A search result is open because it was asked for.
              const open = needle.length > 0 || opened.has(key);
              const done = module.topics.filter((topic) => topic.status === 'done').length;

              return (
                <div key={module.module} className="border-edge bg-surface rounded-lg border p-md">
                  <h3>
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() =>
                        setOpened((current) => {
                          const next = new Set(current);
                          if (!next.delete(key)) next.add(key);

                          return next;
                        })
                      }
                      className="text-text/70 flex min-h-11 w-full items-center justify-between gap-sm text-left text-sm font-medium"
                    >
                      <span className="min-w-0">{module.module}</span>
                      <span className="text-text/40 figures shrink-0 text-xs">
                        {done}/{module.topics.length}
                        <span aria-hidden="true" className="ml-xs">
                          {open ? '\u2212' : '+'}
                        </span>
                      </span>
                    </button>
                  </h3>

                  {open ? (
                    <ul className="mt-xs flex flex-col gap-xs">
                      {module.topics.map((topic) => (
                        <li
                          key={topic.stableKey}
                          className="flex items-start justify-between gap-sm"
                        >
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
                              {topic.needsReview ? ' \u00b7 target not parsed' : ''}
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
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {needle && shown.length === 0 ? (
        <p className="text-text/50 text-sm">Nothing matches that.</p>
      ) : null}

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
