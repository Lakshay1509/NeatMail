/**
 * Stops in-browser page translation (Chrome/Edge auto-translate, Google Translate)
 * from crashing React with:
 *
 *   NotFoundError: Failed to execute 'removeChild' on 'Node':
 *   The node to be removed is not a child of this node.
 *
 * Why this happens: the translator rewrites TextNodes into <font> wrappers, which
 * re-parents nodes React still holds references to. On the next update React calls
 * removeChild/insertBefore against the parent it remembers, the node now lives
 * somewhere else, and the DOM throws. Because this app has no route-level error
 * boundary of its own the throw reached Next's built-in global error page, so a
 * translated tab lost the whole document — which is what non-English users hit
 * during onboarding (PostHog: DOMException, 4 users / 4 sessions).
 *
 * The fix is React's own recommended workaround, verbatim from Dan Abramov on
 * facebook/react#11538 (comment 417504600): make the two mutations no-op instead
 * of throwing when the node has been re-parented out from under React.
 *
 * Two tradeoffs, both accepted deliberately and both called out in that comment:
 *  - It costs a parent check on every DOM mutation, so it is marginally slower.
 *  - Genuine parent-mismatch bugs stop throwing and get reported instead. That is
 *    why the suppressed calls are sent to PostHog rather than swallowed silently —
 *    a spike from users who are NOT translating would mean a real bug is hiding here.
 *
 * This does not make translation render perfectly; it makes it non-fatal. The
 * volatile text nodes it can't save (see the typewriter in /onboard-complete) are
 * marked translate="no" at the component instead.
 */

type PatchedNode = typeof Node & { __neatTranslateGuard?: boolean };

// Reported once per page load per kind. The failure repeats every frame once a
// translated subtree starts fighting React, and an unthrottled report would turn
// one crash into thousands of PostHog events.
const reported = new Set<string>();

function report(kind: "removeChild" | "insertBefore") {
  if (reported.has(kind)) return;
  reported.add(kind);

  // Imported lazily: this module runs before the app boots, and pulling posthog-js
  // into that path would put the whole SDK in front of first paint.
  void import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.captureException(
        new Error(`DOM mutation suppressed by translate guard: ${kind}`),
        {
          guard_kind: kind,
          // The tell for in-browser translation: the translator sets `lang` on
          // <html> to the target language, while this app always ships lang="en".
          document_lang: document.documentElement.lang,
          translated:
            document.documentElement.lang !== "en" ||
            document.documentElement.classList.contains("translated-ltr") ||
            document.documentElement.classList.contains("translated-rtl"),
        },
      );
    })
    .catch(() => {});
}

export function installTranslateGuard() {
  if (typeof Node !== "function" || !Node.prototype) return;

  const node = Node as PatchedNode;
  // React's fast refresh and repeated client navigations can re-run module code;
  // patching a patch would stack a parent check per reload.
  if (node.__neatTranslateGuard) return;
  node.__neatTranslateGuard = true;

  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      report("removeChild");
      return child;
    }
    return originalRemoveChild.call(this, child) as T;
  };

  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(
    this: Node,
    newNode: T,
    referenceNode: Node | null,
  ): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      report("insertBefore");
      return newNode;
    }
    return originalInsertBefore.call(this, newNode, referenceNode) as T;
  };
}
