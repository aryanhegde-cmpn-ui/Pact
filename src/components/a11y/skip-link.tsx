/**
 * Skip to the content.
 *
 * The first focusable thing on every signed-in page, visible only once it has
 * focus. Without it, reaching the page content by keyboard means tabbing
 * through the whole sidebar on every navigation.
 *
 * ---------------------------------------------------------------------------
 * THE PADDING GOES IN THE FOCUS STATE, NOT ON THE BASE CLASS.
 * ---------------------------------------------------------------------------
 * `sr-only` is `width: 1px; height: 1px` with the content clipped, and Preflight
 * makes every box `border-box` -- so padding on the same element cannot shrink
 * below itself, and the "hidden" link rendered as a 24px invisible box. It was
 * invisible, it was not reachable by pointer, and it failed the 44px
 * touch-target check on all eleven surfaces, which is how it was found.
 * ---------------------------------------------------------------------------
 *
 * Not a client component: a link to an anchor needs no JavaScript.
 */
export function SkipLink(): React.JSX.Element {
  return (
    <a
      href="#content"
      className="bg-signal text-ground sr-only rounded text-sm font-medium focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-2 focus-visible:z-50 focus-visible:px-md focus-visible:py-sm"
    >
      Skip to content
    </a>
  );
}
