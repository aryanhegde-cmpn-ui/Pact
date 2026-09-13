import { covered, type PageRegistration } from './cases';

/**
 * Every page route, and the test that asserts something about it.
 *
 * ---------------------------------------------------------------------------
 * "RENDERED" MEANS ASSERTED AGAINST, NOT LOADED.
 * ---------------------------------------------------------------------------
 * The landing page was loaded by every spec in the suite -- each one signed in
 * through it -- and shipped with a 600px form on a 390px screen anyway. Being
 * touched is not coverage, and this list exists so the difference has to be
 * declared.
 * ---------------------------------------------------------------------------
 */
export const PAGE_REGISTRY: readonly PageRegistration[] = [
  { route: '/', rendered: covered('fits the form inside the viewport'), public: true },
  { route: '/recover', rendered: covered('asks for the identifier and the code together'), public: true },
  { route: '/join', rendered: covered('the invite redemption page fits a phone'), public: true },
  { route: '/offline', rendered: covered('the offline fallback fits a phone'), public: true },
  {
    route: '/focus/[commitmentId]',
    rendered: covered('renders without navigation and without overflowing'),
    public: false,
  },
  { route: '/dashboard', rendered: covered('leads with a greeting and the next action'), public: false },
  { route: '/tomorrow', rendered: covered('Tomorrow shows what is coming without letting it be started'), public: false },
  { route: '/week', rendered: covered('This Week gives each day its own row rather than a squeezed grid'), public: false },
  { route: '/progress', rendered: covered('Progress shows a rolling rate and never a streak'), public: false },
  { route: '/postponements', rendered: covered('Postponements groups the answered, moved and missed again'), public: false },
  { route: '/settings', rendered: covered('Settings offers recovery codes, quiet hours and vacation mode'), public: false },
  { route: '/stakes', rendered: covered('the primary sees it on their stakes page'), public: false },
  { route: '/study', rendered: covered('Study leads with the three blocks rather than a subject list'), public: false },
  { route: '/study/curriculum', rendered: covered('the curriculum browser collapses to modules that open on demand'), public: false },
  { route: '/study/phases', rendered: covered('Phases shows drift against the original dates'), public: false },
  { route: '/study/review', rendered: covered('the review queue lists what the parser refused to guess'), public: false },
  { route: '/overseer', rendered: covered('renders, which nothing checked before'), public: false },
];
