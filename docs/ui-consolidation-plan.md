# UI Consolidation Plan

## Recommendation

Keep Tailwind, Headless UI, Motion and CVA as the existing foundation. Consolidate shared visual recipes and intentional variants before replacing behavior. Do not make one universal component that treats commands, navigation links, tabs, radio choices and checkboxes as interchangeable.

Prefer Tailwind's built-in palette for ordinary editor chrome and feedback where it suits the design. Expose colors through semantic Tailwind theme names so components do not depend on particular palette steps. Keep intentional brand colors and user-authored artwork colors separate. Introduce semantic aliases without changing appearance first; evaluate any palette changes in a separate visual pass.

This is an audit/design reference, not a second progress tracker. Implementation status remains in [../docs/roadmap.md](../docs/roadmap.md). The findings below describe the pre-migration source; the implementation follows the staged sequence while preserving the documented domain boundaries.

## Audit Scope

The audit covered all 21 TSX modules, shared styles and primitives, the frontend dependency/entry-point graph, canvas color/export boundaries, and relevant regression coverage. Static module reachability identifies 15 TSX files reachable from the entry point and six dormant files. Reachability is not a count of components mounted on every screen.

Current product scope is the browser-local editor described in [../README.md](../README.md), not the retained account/provider feature set. [local-only.spec.mjs](../apps/web/tests/local-only.spec.mjs#L1) explicitly checks that legacy account/provider preferences cannot reopen removed features or cause API/provider requests.

There are two CVA definitions: the shared button recipe and the canvas tool-button recipe. Across all TSX files, including dormant code, there are 42 shared `Button` sites, eight native button sites, 11 native input sites, two textarea sites and seven shared `Modal` sites. These are source locations, not runtime instance counts or evidence that every native element is duplication.

This was a source audit, not a new visual/accessibility certification. No browser suites were rerun for planning.

## Colors At Audit

We are using Tailwind utilities, but most editor chrome is **not using Tailwind's default color palette**.

| Area                      | Current approach                                                                                                          | Assessment                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Editor chrome             | Root hex variables such as `--bg: #171a1c`, `--panel: #202426`, `--line: #3a4247`, `--text: #eef1f3`, `--accent: #d8f36a` | Centralized custom palette, consumed through Tailwind utilities such as `bg-(--panel)` |
| Success/danger and errors | Emerald/red Tailwind utilities                                                                                            | Already uses built-in palette values                                                   |
| Primary button foreground | Literal `#19200d` in the shared recipe                                                                                    | Should become a semantic foreground token                                              |
| Brand foreground/shadows  | Further literals, including `#171a12` and translucent black shadows                                                       | Centralize intentional shared values; use standard shadow recipes where suitable       |
| Canvas themes             | Eight hex palettes: Ink, Forest, Ocean, Plum, Rose, Cocoa, Sun, Snow                                                      | Artwork data, not editor chrome                                                        |
| User-selected colors      | Persisted hex values and native color inputs                                                                              | Must remain supported independently of the Tailwind palette                            |
| Provider branding         | Facebook/Discord brand hex values and Google's multicolor mark                                                            | Brand exceptions, currently in dormant UI                                              |
| Tools over images         | Translucent black/white and calculated contrast                                                                           | Legitimate contrast treatment over arbitrary image content                             |

The chrome variables live in [styles.css](../apps/web/styles.css#L84); button colors live in [controls.tsx](../apps/web/src/components/ui/controls.tsx#L112). There is no semantic `@theme` color namespace yet. Canvas palettes live in [model.ts](../packages/contracts/model.ts#L371), not the stylesheet.

Tailwind v4 exposes its default colors as `--color-*` variables and supports custom theme colors. Custom colors are valid Tailwind colors too; the question is whether a value is centralized and intentionally owned, not merely whether it is a hex literal.

### Proposed Color Ownership

1. **Editor chrome:** semantic names such as `ui-background`, `ui-panel`, `ui-workspace`, `ui-border`, `ui-selected`, `ui-text`, `ui-muted`, `ui-accent` and `ui-on-accent`. Add `@theme inline` aliases for existing variables first. Components then use named utilities such as `bg-ui-panel` and `text-ui-muted`.
2. **Standard feedback:** define consistent success, danger and warning recipes using suitable built-in Tailwind palette steps. Check foreground/background contrast in every enabled, disabled and hover state.
3. **Palette-backed chrome:** compare a restrained neutral/zinc foundation with a lime accent against the existing design. Do not approximate every existing hex silently. A deliberate custom accent can remain if the default palette is a worse fit. Keep this visual decision separate from the structural migration.
4. **Artwork:** retain validated hex values and shared model defaults. Do not substitute CSS variable references or raw Tailwind OKLCH values in persisted documents, native color inputs or the existing hex-only contrast functions.
5. **Branding:** preserve exact brand values in named, narrowly owned tokens if dormant provider UI is retained.
6. **Image feedback:** keep theme-derived contrast calculations and black/white overlays. Share their recipes where repeated, without replacing them with fixed editor chrome colors.

Preserve `control-hover`: its existing contract mixes 25% of the relevant tint into the normal background without changing borders. Centralize remaining shared shadow/foreground literals. Do not ban arbitrary Tailwind values needed for actual canvas geometry.

## Component Findings

| Surface                  | Existing reuse                                                        | Proposed action                                                                         |
| ------------------------ | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `Button`                 | CVA, forwarded ref, default button type, common focus/disabled states | Separate intent from size/presentation; eliminate repeated size overrides               |
| `ButtonGroup`            | Shared joined borders and corner handling                             | Share a joined-control recipe with choices/tabs, not their interaction semantics        |
| `IconRadioField`         | Headless UI RadioGroup and native-disabled choice adapter             | Reuse joined-control/option recipes and typed layout variants                           |
| `SelectField`            | Headless UI Listbox, labels, viewport-aware anchored options          | Consolidate trigger/option styling and supported density/font-preview variants          |
| `ColorField`             | Native picker, hex draft validation, Headless UI DataInteractive      | Keep behavior; share field framing and explicit size variants                           |
| `PercentField`           | Native range, normalized mapping, accessible output                   | Add a small range base only where needed; retain percentage mapping as an adapter       |
| `Toggle`                 | Headless UI Switch, Motion thumb animation                            | Keep one implementation and shared switch/motion recipes                                |
| Design disclosures       | Headless UI Disclosure and shared Motion AccordionPanel               | Share main-section trigger/chevron recipes; show detailed controls directly             |
| `Modal`                  | All dialog sites share Headless UI Dialog plus Motion                 | Keep one modal; use size/layout CVA variants and preserve focus/exit coordination       |
| `ImageTabs`              | Shared tabs, but custom keyboard/ARIA logic                           | Test Headless UI Tabs against selected-native-disabled requirements before replacing    |
| Reset choices            | Native labeled checkboxes and separate theme RadioGroup               | Shared checkbox field/option recipe; preserve selective-reset behavior                  |
| Search/name inputs       | Native inputs with global/local styling, mostly dormant               | Use shared field/input recipes when retained or mounted                                 |
| `GridCell` tools         | Specialized CVA recipe layered on shared Button                       | Keep domain adapter; factor only duplicated visual treatment                            |
| Library and upload cards | LibraryImage already wraps GridCell; shared CardBorder/CardFrame      | Preserve successful reuse and genuinely different drag/select/upload semantics          |
| Spinners/status          | Lucide loaders and local status presentation                          | Share size/tone styling where repeated; status labels belong to the consuming operation |
| Account/provider UI      | Shared Modal/Button/feedback already exists, but files are dormant    | Decide retention first; do not reactivate or expand it during cleanup                   |

### Buttons And Joined Controls

Start with [controls.tsx](../apps/web/src/components/ui/controls.tsx#L112). The current `variant="icon"` mixes dimensions/presentation with intent; callers repeatedly add `min-h-11`, padding, icon sizes and ancestor overrides.

Use a small set of independent CVA axes:

- `intent`: neutral, primary, success, danger; retain only supported uses.
- `size`: regular, compact and explicitly supported icon sizes.
- `presentation`: text/icon-plus-text versus icon-only, with compatible compound variants.

Keep native `disabled`, selected state and `aria-busy` semantics distinct. Add loading presentation only if real consumers need it; loading must not silently resize buttons or disable unrelated controls. Preserve Design availability during imports and the existing Reset/import/export restrictions.

Use CVA for intentional visual differences, not incidental coordinates. Caller `className` remains available for placement and domain geometry. Do not depend on class-string order to resolve conflicting padding/background utilities. Avoid adding `tailwind-merge` unless a demonstrated remaining conflict justifies it.

Maintain 44px normal UI targets, stable icon/button dimensions, joined one-pixel borders and outer-only corners. Proportional canvas overlays are a separate domain recipe, not an excuse to shrink general controls.

Share joined-control classes between ButtonGroup, IconRadioField and ImageTabs only where geometry/states truly agree. Preserve command, radio and tab behavior in separate components. Provider navigation must remain a link; reuse its visual recipe without nesting or converting it into a command button.

### Fields, Ranges And Checkboxes

Introduce a small field composition using Headless UI `Field`, `Label` and `Description` where compatible. Share label, description, validation, focus and disabled styling without creating a schema-driven form framework.

The range family has three concrete cases:

- Existing PercentField maps domain values onto a normalized 0-100 slider.
- Caption opacity in [App.tsx](../apps/web/src/App.tsx#L1272) duplicates range/label/output structure and is already a percentage.
- Crop zoom in [../apps/web/src/components/CropEditor.tsx](../apps/web/src/components/CropEditor.tsx) uses a different scale and output in a fullscreen tool.

A small native `RangeField` can share labeling/output/styling. PercentField remains an adapter; crop zoom retains its real range/step and crop-engine behavior. Do not hand-build a slider interaction engine.

Extract repeated font-weight range configuration into a narrow typography helper/component only if the heading/card controls can share it without conflating their values, labels, IDs or patch callbacks. Font-family previews keep dynamic inline typography.

For reset and retained publish controls, prefer a shared Headless UI Checkbox composition with Lucide check/minus icons, labels and descriptions. First verify native form/focus/test contracts; a shared native checkbox wrapper is acceptable if replacement adds incompatibility. Reset scope selection remains domain state, not checkbox component logic.

Preserve label-click toggling, Space behavior, disabled state, description association, fresh unchecked Reset choices on every opening, Current/Default radio exclusivity, and transactional document/media effects. Add indeterminate styling only if the All control actually adopts that behavior; do not change its meaning during styling work.

Keep ColorField's optional-`#` six-digit input, valid draft updates, invalid/incomplete blur/Escape recovery and picker synchronization. Hover must follow the actual interactive controls rather than their labels. Native color/file inputs are browser functionality worth keeping, not homemade UI engines.

### Disclosures, Popups And Motion

[PresetsPanel.tsx](../apps/web/src/components/PresetsPanel.tsx#L1) is the owning Design composition. Reuse its shared AccordionPanel and DisclosureTrigger recipe for main section headers, and render detailed controls directly inside each section.

Keep Headless UI responsible for disclosure state, linked panels and keyboard behavior. Keep the existing one-main-section-open policy and application-specific reveal logic: the library cannot infer the sidebar's sticky tabs, clipping or available content height.

For dropdowns and popups:

- Listbox remains the value-selection engine; Menu remains the command-menu engine; Popover remains contextual card tools.
- Reuse popup surface, option/item, focus and density recipes where compatible.
- Preserve font previews, viewport-width constraints, nonmodal behavior and existing overlay-scrollbar dismissal handling.
- Add a shared short popup animation only where it improves the currently unanimated Listbox; do not introduce motion just because Motion is installed.

CVA variants own classes. Motion variants own animation values. They are complementary, not interchangeable.

Keep the global LazyMotion and reduced-motion policy in [../apps/web/src/main.tsx](../apps/web/src/main.tsx). Centralize reusable popup fade/offset, disclosure height/opacity and chevron timing. Existing durations vary by purpose: approximately 140ms for menus, 160ms for switches and 180ms for disclosures/modals. Shared timing does not require every interaction to animate identically.

Use Tailwind transitions for simple persistent hover/color states. Use Motion/AnimatePresence for mount/unmount and height transitions. Preserve inert/aria-hidden exiting panels and modal background locking through exit. Reduced motion must cover CSS transitions as well as Motion transforms/layout; verify opacity/timing behavior rather than assuming the global configuration removes every animation.

Do not replace scroll/layout measurements, upload progress or search debounce timers with animation abstractions. Modal readiness and focus restoration are coordination logic; remove their requestAnimationFrame work only after a focused check proves it unnecessary.

### Tabs Compatibility Check

[../apps/web/src/components/ui/ImageTabs.tsx](../apps/web/src/components/ui/ImageTabs.tsx) manually implements tab keyboard/ARIA behavior. Headless UI TabGroup is the preferred engine, but its normal model skips disabled tabs, whereas this app deliberately keeps the selected tab natively disabled.

Before migration, test controlled selection with a selected-native-disabled tab, horizontal/vertical keyboard movement, Home/End, Enter/Space activation, narrow icon-only labels, responsive placement, focus and Back/Forward restoration. Reject any adapter that changes the selected panel automatically or substitutes `aria-disabled` for the required native-disabled contract.

If the installed library cannot honor that contract, retain one narrow custom tab adapter with shared CVA styling. Do not duplicate another tab engine or silently weaken the behavior to claim library reuse.

## Keep These Domain Boundaries

| Files                         | Why they remain distinct                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| App and EditorLayout          | Editor state/composition and width-plus-height panel placement; extract repeated image-library/advanced-field composition only when useful |
| GridPreview and GridResizer   | Shared canvas geometry, native viewport scrolling, attached resize controls and content retention                                          |
| GridCell                      | Image/caption/crop/drag/tool behavior; retain specialized overlay-button recipe                                                            |
| LibraryImage and UploadTile   | Existing shared card rendering, but selection/drag adapters and native upload destinations differ                                          |
| CardFrame                     | Shared pixel-accurate solid/dotted feedback and persisted card borders; SVG here is domain rendering, not a homemade icon library          |
| CropEditor                    | Existing react-easy-crop engine plus shared fullscreen Modal                                                                               |
| TextScrollbar                 | External native-textarea rail, centering/caret and narrow-screen placement                                                                 |
| Browser scrollbar initializer | Existing OverlayScrollbars engine with stationary sibling rails and native scrolling                                                       |
| Model, canvasTheme and export | Persisted artwork colors, contrast and geometry shared with exported pixels                                                                |

OverlayScrollbars' current documentation explicitly lists direct textarea initialization as unsupported. Keep TextScrollbar unless a real supported alternative preserves textarea semantics and the external rail. Do not move scrolling to a wrapper that breaks caret scrolling or makes React children library-owned.

Retain use-gesture for touch image movement, native mouse/file drag-and-drop, and react-easy-crop for cropping. Compatibility-click suppression, cancellation, scroll reveal and canvas measurement are application integration, not generic animation duplication.

## Dormant And Legacy Code

No entry-point callers were found for AccountDialog, AccountUi, LoginDialog, OnlineImages, SavedGridsDialog or ThemeThumbnail. Generic Accordion, TemplateAccordion and ActionMenu also have no application callers, although their containing controls module is active.

Make an explicit retention decision before migrating these surfaces. For clearly obsolete generic exports, remove them after reference checks rather than polishing unused abstractions. TemplateAccordion's effect-driven button click should not become a new controlled-disclosure framework merely to preserve an unused export.

If retained account/provider UI is needed later, migrate its ProviderTile button/link recipe, confirmation/notice presentation, text/search fields, publish checkbox, topic buttons and saved-item rows onto the same primitives before mounting it. Preserve real OAuth links and exact provider branding. Do not rebuild it now, create new preview engines or restore network calls.

[styles.css](../apps/web/styles.css#L1) still contains substantial legacy unlayered control/layout CSS. Examples with no frontend source-string references include `app-header`, `header-actions`, `filter-tabs`, `board-tabs`, `icon-button`, `settings-panel`, `field-pair`, `color-field`, `segmented` and `export-section`. These are deletion candidates, not a blanket proof of dead CSS: confirm templates, generated class construction, tests and library markup first.

Unlayered rules can override Tailwind utilities and contribute to repeated important modifiers. Migrate global control defaults to appropriately layered baseline styles or owned primitive recipes, then remove specific overrides incrementally. Retain useful third-party styling such as OverlayScrollbars and crop-engine rules. Do not enable Preflight wholesale as part of this refactor.

## Implementation Sequence

### 1. Record Contracts And Add Semantic Tokens

Work in the stylesheet and existing shared controls. Record current hover/disabled/focus, joined geometry and normal target-size expectations. Add semantic Tailwind color/shadow aliases using current values, then migrate a small representative set of controls.

Gate: aliases generate the expected utilities, unchanged computed colors/hover mixing, no color/export/model changes, no new canonical-class diagnostics. Run the focused existing hover/controls check after the first migration.

### 2. Refactor Button And Joined Recipes

Introduce the smallest intent/size/presentation variant model, migrate active button consumers, and share joined geometry with IconRadioField and ImageTabs where appropriate. Keep the specialized GridCell tool recipe.

Gate: selected choices remain natively disabled; keyboard focus skips them correctly; joined borders/corners and dimensions are stable. Verify header/export, sidebar tabs and row/column controls. Remove superseded call-site/ancestor overrides only after these checks pass.

### 3. Consolidate Fields And Reset Options

Reuse field framing, caption-opacity range structure and repeated typography configuration. Add the shared checkbox option, migrate Reset first and preserve its state/transaction semantics. Keep native color input and hex validation behavior.

Gate: normalized ranges/output, independent typography, reset selections, blur/Escape recovery, dropdown keyboard behavior and persisted values pass focused checks. Any native-to-Headless checkbox change needs direct keyboard/label/disabled coverage.

### 4. Consolidate Disclosure And Popup Styling/Motion

Share main-section trigger and chevron recipes, timing and existing AccordionPanel. Keep detailed controls directly visible within the open section. Align Listbox popup styling with reusable surface/option recipes. Do not expand unused Menu exports.

Gate: one-main-section-open behavior, linked panels, keyboard toggles, reveal in the owning scroller, exit inertness, reduced motion, dropdown scroll handles and outside dismissal remain correct.

### 5. Refine Modal Variants And Run The Tabs Check

Use CVA for existing compact/wide/fullscreen modal layout differences, keeping one Dialog implementation. Run the narrowly scoped Headless Tabs feasibility check; migrate only if its contracts pass. Keep responsive placement and native-disabled semantics otherwise.

Gate: crop/export/image-picker/conflict dialogs remain usable; background stays locked through exit; desktop focus restoration works; touch opening does not summon a text keyboard. Tabs preserve selection across orientation, resize, reload and history.

### 6. Finish Active Compositions And Remove Proven Legacy CSS

Extract repeated local image-library composition or advanced typography sections only if that reduces meaningful duplication. Share spinner/notice recipes where active consumers warrant it. Remove proved-unused selectors and replace remaining inherited control defaults in small slices.

Gate: canvas/library/upload/picker borders and feedback match; cell content/crops survive resizing; textarea rails remain external; preview/export geometry stays pixel-compatible. No Preflight switch, unrelated layout redesign or broad important-modifier purge.

### 7. Resolve Dormant Frontend Ownership

Make the retention/removal decision explicit. Remove obsolete frontend exports/styles if approved, or document retained legacy modules without polishing or mounting them. Keep the retained backend/data compatibility separate.

Gate: local-only tests still show no account/provider UI or requests, and no active imports reference removed modules. Never treat this phase as approval to remove backend APIs, stored data or provider-reference compatibility.

### 8. Evaluate Palette Changes Separately

After structural reuse is stable, compare palette-backed chrome with the current appearance on desktop, narrow mobile and short/landscape layouts. Choose intentional semantic token values; check contrast, focus, selected/disabled states and overlays over light/dark artwork.

Gate: visual comparison is approved; only editor chrome changes. Existing/saved artwork palettes, selected colors, crop output and canvas defaults are unchanged unless separately requested.

Each phase should be an independently reviewable change. Keep shared APIs stable where practical. Start in existing modules; split a component family into a new file only when its ownership or complexity warrants it. No new framework, universal form engine or one-file-per-trivial-wrapper expansion is needed.

## Verification Plan

Reuse [../apps/web/tests/editor.spec.mjs](../apps/web/tests/editor.spec.mjs), [../apps/web/tests/model.spec.mjs](../apps/web/tests/model.spec.mjs) and [../apps/web/tests/local-only.spec.mjs](../apps/web/tests/local-only.spec.mjs). Add focused cases there for meaningful new behavior or gaps, rather than introducing a parallel test system.

Relevant existing editor checks cover shared quarter-strength hover, normalized sliders, native color inputs/listboxes, native-disabled keyboard choices/tabs, joined buttons, Design disclosures/reveal, reduced-motion animation, viewport-edge modals, overlay scrollbars, independent typography, borders and preview/export matching. Select the affected checks for each phase instead of rerunning the entire suite after every edit.

Run typechecking/build and touched-file formatting/canonical Tailwind diagnostics for code phases. Run broader editor/local-only/model gates once at the integrated checkpoint, with desktop, narrow mobile, short landscape, touch, keyboard and reduced-motion coverage. Visually inspect stable control geometry and theme feedback, not just screenshots of a loading state.

The latest full-suite run reported before this audit was **157 passed and 10 timed out out of 167 tests**. The original CI failures passed focused reruns, but the full baseline was not completely green. Do not label pre-existing timeouts as refactor regressions or claim a clean baseline; isolate them when establishing the integrated gate. No additional tests were run for this documentation-only audit.

### Completion Criteria

- Active commands, choices, fields, disclosures and dialogs use owned shared primitives/recipes with intentional typed CVA variants.
- Repeated size/state overrides are removed where supported; domain placement and artwork geometry remain local.
- Ordinary editor colors have semantic Tailwind ownership; built-in palette adoption and intentional exceptions are documented.
- User-authored/model artwork colors remain independent, validated and export-compatible.
- Headless UI owns supported interaction behavior; Motion owns lifecycle/layout animation; Tailwind owns ordinary styling/transitions.
- Selected-native-disabled behavior, reset state, focus, touch, scroll, reduced motion and pixel geometry remain intact.
- Dead generic exports/styles are removed only after proof and scope agreement; removed account/provider UI remains removed.
- Required focused/integrated checks pass, with any remaining baseline failures reported explicitly.

## References

- [Tailwind colors](https://tailwindcss.com/docs/colors): built-in palette, theme variables, custom colors and aliases.
- [Headless UI Checkbox](https://headlessui.com/react/checkbox): controlled state, labels/descriptions, form integration and indeterminate support.
- [Headless UI Tabs](https://headlessui.com/react/tabs): controlled selection, disabled-tab and keyboard behavior.
- [Motion AnimatePresence](https://motion.dev/docs/react-animate-presence): lifecycle/exit animations and presence state.
- [OverlayScrollbars](https://kingsora.github.io/OverlayScrollbars/): existing engine and documented textarea limitation.
