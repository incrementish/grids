# Gridz

A browser-local image editor built with React 19 and Vite. Fresh workspaces start with an empty 3x3 grid in a refined dark style: square images, subtle rounded corners, balanced spacing and readable captions over the bottom of each image. Users upload their own images; editing, themes and exports need no account or backend. There is no account menu, sign-in flow, information dialog or image-provider picker.

## Run

The product name is **Gridz**. Existing `@grids/*` workspace names, `grids-*` storage/database identifiers, `GRIDS_*` environment variables, `X-Grids-*` headers and deployed URLs are compatibility identifiers and intentionally unchanged by the rebrand.

Requires Node.js 22.12 or newer. Node.js 22 is used for deployment. This is one Git repository with npm workspace packages, like Chatter:

| Workspace            | Purpose                                                 |
| -------------------- | ------------------------------------------------------- |
| `apps/web`           | React/Vite frontend                                     |
| `apps/api`           | Express provider sign-in, sessions and saved-item API   |
| `packages/database`  | Postgres access and versioned SQL migrations            |
| `packages/contracts` | Shared strict schemas and grid/settings transformations |

For frontend development:

```sh
npm ci
npm run dev:web
```

Open the localhost URL printed in the terminal, normally http://localhost:5837. If that port is occupied, Vite automatically tries the next available port. Use Vite rather than opening the HTML directly so modules, fonts, and canvas exports load consistently.

### Legacy Accounts And Database

The frontend no longer uses account/session APIs or offers sign-in, account management or cloud collections. The API, database migrations and existing cloud data remain intact for compatibility. The setup below describes that retained backend, not features available in the editor.

AccountDialog, AccountUi, LoginDialog, OnlineImages, SavedGridsDialog and ThemeThumbnail are retained frontend modules, deliberately disconnected from the application entry point. Shared-control maintenance does not reactivate them. Restoring any of these features requires a separate product decision; existing provider-reference compatibility remains independent of search/sign-in UI. Unused generic accordion and action-menu exports have been removed rather than maintained as a second control framework.

1. Copy `.env.example` to the root `.env` (preserve any existing credentials). Set `POSTGRES_PASSWORD` and the matching URL-encoded password in `DATABASE_URL`.
2. Start Docker Desktop, then run `npm run db:up`. Postgres 16 uses a named persistent volume and binds only to localhost port **5433**, leaving Chatter's port 5432 alone.
3. Configure both credentials for each desired sign-in provider in the root `.env`. Unconfigured providers are hidden; partially configured providers fail startup explicitly. No OAuth secrets enter the frontend build.
4. Run `npm run db:migrate`, then `npm start`. This starts the API on **5841** and the web app on **5837**. The API also applies migrations transactionally on startup, with an advisory lock. Stop development processes with Ctrl+C; `npm run db:stop` stops Postgres without deleting its volume.

Register these exact development callbacks in the provider consoles:

- Google: `http://localhost:5841/api/auth/google/callback`
- Facebook: `http://localhost:5841/api/auth/facebook/callback`
- Discord: `http://localhost:5841/api/auth/discord/callback`

Use the provider's development/test-user configuration where required; Facebook may require HTTPS/app review for the intended deployment. Never reuse Chatter's production secrets. `WEB_URL` is the fixed return URL after login (including any frontend subpath); `PUBLIC_API_URL` is the API origin, without `/api`. If Vite uses another port, update `WEB_URL` and restart the API. The dev server proxies `/api`; provider callbacks go directly to port 5841. Production configuration requires HTTPS.

The editor does not fetch sessions or cloud collections, and never uploads the browser draft automatically. Existing server APIs and saved data remain intact. Account deletion through the retained API still removes its sessions, saved grids and private/public presets.

**No image hosting:** saved grids contain layout, captions, crops, approved image-provider provenance and image references, plus opaque IDs for browser-local images. They never contain uploaded files, image bytes, blob/data URLs or local file paths. Provider images load directly from their original hosts after reload; neither Postgres nor IndexedDB stores provider image binaries. Initial import still validates the image using the existing 20 MB/40 MP limits. Browser-local uploads remain in IndexedDB until removed or browser storage is cleared, and can be resolved when loading a saved grid in that same browser. On another browser their cells retain captions/layout but are empty, with a warning. A deleted/unavailable provider image cannot be guaranteed to reload or export; failures remain visible. Provider images are not guaranteed offline.

**Images**, **Design** and an icon-only **Reset** trigger share the editor sidebar and compact bottom shelf. Design is a four-step builder: Colors, Layout, Canvas heading, and Card headings. Reset opens a dialog without replacing the active panel. There is no selected whole theme, separate Settings tab, sample-image preview, or per-theme customization store.

New and reset grids use the Ink color theme. Colors shows the applied theme and selects its swatch; edited colors retain the theme name with a Modified status across panel changes and reloads. Reapplying a color theme restores its original palette without resetting other design choices. Open sections directly using their accordion headers; there are no Next buttons. Nested Customize disclosures use indented rails and filled summary rows to distinguish them from the main sections.

Both accordion levels use Headless UI Disclosure with Motion height/opacity transitions and reduced-motion support. Main sections open one at a time and can be collapsed using their headers. Opening a section keeps its toggle and as much content as possible visible within the sidebar or mobile shelf, accounting for sticky tabs without scrolling the canvas or page. Closing animated panels are inert until their exit completes.

Colors offers eight coordinated palettes and independent canvas/heading/card color controls under **Customize**. Palette cards adapt from one to four columns based on available panel width. Applying a palette changes only colors. Layout provides image shape, seamless/compact/spacious spacing, rounded corners and a **Show borders** toggle. Card borders are off by default; enabling them reveals color and proportional thickness controls (0-5% of card width). Turning borders off keeps the chosen color and thickness, and never disables hover/focus or drop-target feedback. Borders are inset without resizing cards, shared across canvas/library/picker/upload/loading cards, saved with the grid and included in exports. Layout's Customize disclosure exposes exact padding, gap and rounding values. Canvas heading and Card headings each provide visibility and typography choices, with precise font weights, sizes, padding and caption-overlay values available in their respective disclosures. Card-heading placement is available directly in its step.

Choices update the real grid immediately and use its ordinary browser autosave. Steps can be revisited in any order; selecting a color palette never resets layout, heading visibility, typography, captions, crops, images, row/column counts or export options. Custom values are retained when moving between steps and reloading. Existing grids are not silently restyled. `?panel=design` (or the older `?panel=themes`) opens the builder; navigation then removes editor parameters from the address as before.

Canvas images, library images and image pickers retain their external hover/focus outlines. Drop-zone outlines are dashed; other cards use solid outlines. Canvas and horizontal-library viewports reserve room for feedback without changing layout or export geometry.

Row and column controls remain in separate groups, with plain minus/plus icons and the same neutral button theme as Reset grid. Their accessible labels, minimum/maximum limits and resize behavior are unchanged.

Editor chrome uses semantic `ui-*` Tailwind colors backed by the built-in zinc/neutral palette, lime accents and emerald success feedback. Components use role utilities such as `bg-ui-background`, `text-ui-muted` and `border-ui-border`, not their own chrome hex values. Artwork palettes, saved/exported colors and native color pickers remain independent hex values; do not substitute CSS variables or OKLCH strings into the persisted artwork model.

Interactive controls share the `control-hover` Tailwind utility: hover mixes 25% of the UI border color into the control's normal background without changing its border. Buttons, tabs, segmented choices, dropdowns and their options, disclosures, switches, color inputs, palette/provider tiles and image tools use this rule. Borderless off-switches use a contrasting text tint so their hover remains visible; on-switches retain their colored state. Customize sub-accordions use the same border and padding as dropdowns. Selected and disabled choices retain their appearance, and keyboard focus indicators remain distinct. New controls should reuse this utility rather than define their own hover colors.

Canvas card, caption and heading hover feedback uses the chosen theme's text colors; library/upload hover and active drop feedback derive from its surface colors. Drop zones change background color and show a spaced dotted border; image cards combine a background-tint overlay with a solid border. Feedback borders have a small 2px offset and do not affect content geometry. Dotted borders use 2px marks and 6px gaps. These editor-only colors do not alter the exported artwork.

Each color palette coordinates the canvas, heading background, card surface and text. Light palettes use readable dark text instead of inheriting the editor's dark UI. The app toolbar and sidebar keep their own colors.

Sessions use random opaque HttpOnly, SameSite=Lax cookies (Secure in production); only token hashes are stored. OAuth state is browser-bound, single-use and expires after ten minutes, with PKCE for Google/Discord. Access/refresh tokens and email addresses are not retained. Provider+subject identifies a sign-in identity; identities are never automatically linked by email. State-changing API calls enforce the exact frontend Origin, a custom request header and JSON bodies. Server-side validation, ownership checks, request limits and a 1 MB document limit apply.

**Legacy connected-provider API:** connecting requires an origin-protected POST and authorization with that provider, bound to the exact initiating Gridz session. A new identity is attached to the current account. If it already belongs to another account, the API creates a ten-minute pending merge: nothing moves until confirmed. The current account keeps its ID/name; incoming identities, grids and presets transfer atomically, retaining IDs, timestamps, duplicate names and public/private status. Incoming sessions are revoked. Cancelled or expired authorization and conflicting identities leave accounts separate. One identity per provider is allowed. These operations are no longer exposed by the editor.

Disconnect actions appear only when more than one provider is connected. Disconnecting a provider requires confirmation and leaves saves intact. It preserves the current session using another configured connected provider, while revoking other sessions authenticated through the removed provider and their pending link/merge authorizations. Disconnect confirmation appears inline beneath the provider tiles. Disconnect and deletion confirmations share compact dark cards with an icon beside the heading and a short explanation of what is removed or kept. At least one currently configured sign-in provider must remain. Logging into a disconnected identity later creates a separate account unless explicitly connected again. Account deletion removes every connected identity and its sessions, cloud saves and pending merge requests. Neither linking, merging nor disconnecting changes browser drafts or local uploads.

Migration `002_linked_providers.sql` copies existing provider identities into `account_identities`, preserves existing account IDs/saves/sessions, and records the sign-in provider for sessions. Deploy the migrated API before the matching frontend. Identity changes use one transactional Postgres advisory lock across API processes; database integration tests cover legacy migration, session binding, merges, conflicts, revocation and concurrent operations.

Signing out invalidates the server session but deliberately leaves the browser draft and uploads unchanged. Loading an account grid makes it the browser's current autosaved draft; this is one shared browser workspace, not a private local cache per account. Clear site data before handing a shared browser to someone else.

### Removed Information Pages

The Terms, Privacy and Support pages and their in-editor dialog are no longer included in public builds. Legacy `?info=` and authentication-return links do not open dialogs.

## Build And Preview

```sh
npm run build
npm run preview
```

The production site is generated in `apps/web/dist/`. Preview normally runs at http://localhost:5838 and also falls back to another port when occupied. Relative build paths support both a GitHub Pages repository URL and a custom domain. Preview is static and does not proxy `/api`; use `npm start` for local account development.

## Install And Offline Use

On Android, open the published site in Chrome and use **Install app** or **Add to Home screen** from its menu. On iPhone, open it in Safari and choose **Share > Add to Home Screen**, with **Open as Web App** enabled if offered. Browser wording and automatic install prompts vary.

After the first online visit finishes caching, Gridz can launch, edit local uploads and export them offline. Its production service worker caches the app, local fonts and icons, not images or API/authentication routes; local uploads remain in IndexedDB. Provider references and account saves require the network. Installation is not backup or cross-device sync, and some browsers keep installed-app storage separate from browser-tab storage. Updates are checked on launch and resume without reusing cached worker scripts. New workers activate automatically; an already-open page reloads only after changes are saved and active editors, settings, dialogs and uploads have finished. Existing installations using the old update behavior may need one close and reopen after deployment; do not clear site data, which contains local images and grids. Service workers are disabled in development; installation requires HTTPS or localhost and the production build.

## Frontend Foundation

Panel placement uses both viewport width and height. The right sidebar is used at widths of 901px and above, or from 640px when the viewport is at least 1.4 times as wide as it is tall. Otherwise, Images, Design and Reset use an icon-only vertical strip on the left of the bottom shelf. Images retains its compact horizontal strip; Design scrolls vertically within the shared shelf, while Reset opens its dialog. Layout-specific Tailwind variants follow the editor's selected placement rather than independent width breakpoints. Scroll areas use thin OverlayScrollbars handles over their content, without reserving native scrollbar gutters. Handles remain visible whenever content overflows. Labels remain accessible and available as tooltips; Up/Down, Home and End move focus between enabled controls, and Enter/Space activates them. The right sidebar keeps horizontal tabs with a 44px-wide icon-only Reset trigger after Design. Export grid remains in the header.

The compact shelf's Add images tile stays square regardless of image shape or caption layout; its icon, labels and spacing scale with the tile width. The bottom panel's full content height is 150px (149px inside the border), while its visible height respects a maximum of 30% of the viewport. Shorter panels scroll internally rather than shrinking the cards below that geometry. Tabs and content share one vertical scroll container with a scrollbar at the panel's right edge; there is no separate scrollbar beside the left tabs. Horizontal image scrolling remains independent. Image cards, the desktop upload tile and the image picker's upload tile retain their existing geometry.

The refined dark default applies to new grids and explicit resets only. Existing saved grids retain their appearance. The default uses a charcoal canvas (#17191b), slightly lighter cards (#23272b), high-contrast text (#eef1f3) over a 75%-opaque dark bottom band (#111315), 6.25% corner rounding, and spacing values of 24 for gaps and 36 for canvas padding.

Canvas cards no longer shrink or grow to fit the viewport. At 100% zoom, image areas are approximately 133px tall: portrait cards are 100px wide, square cards 133px, and landscape cards 178px. The header's Zoom slider ranges from 50% to 200%, defaults to 100%, and remembers the chosen value in browser UI preferences. Larger boards scroll within the canvas. Zoom changes only the preview, not export dimensions or saved artwork settings.

Zoom stays directly beside Export in every header layout. Header sizing uses measured available space: the brand and Export labels disappear together before Zoom starts shrinking continuously from its 160px maximum. Below the 80px width needed by its label row, Zoom hides the visible label and value while retaining its accessible name, centers the track vertically, and can shrink to 32px without scrolling. The logo block always remains visible at 44x44px, matching the header icon buttons. Expanding the viewport restores the Zoom label and maximum width before restoring the brand and Export labels. Stacked slider labels have no extra vertical gap and use 8px horizontal padding to inset their text from the track ends.

Empty canvas cards show a muted row-by-column coordinate, such as 2x3, in the bottom-right corner, with a full accessible description. Coordinates follow the current column count after resizing, disappear when an image is placed, and return when cleared. They are preview-only, not captions or exported artwork, and do not appear on library cards.

Controls use Headless UI for accessible interactions, Motion for animation, Lucide icons and Tailwind CSS v4 for styling. Destructive actions use the shared red danger variant. Tailwind uses standard, unprefixed utilities without Preflight while existing canvas styles are migrated incrementally. All application modules use TypeScript/TSX and are strictly checked during every production build; run `npm run typecheck` separately when needed. Directly executed Node configs and browser-test scripts use `.mjs`. Do not add authored `.js` or `.jsx` files; Vite's generated JavaScript bundles are build output, not application source.

Shared controls live in [apps/web/src/components/ui/controls.tsx](apps/web/src/components/ui/controls.tsx). Button CVA axes separate `intent` (neutral/primary/success/danger), `size` (regular/compact/fluid) and `presentation` (text/icon). Joined command groups, radio choices and tabs reuse the same border/corner recipes without merging their different semantics. RangeField/PercentField, CheckboxField, color inputs, dropdowns, disclosure triggers, switches and spinners compose existing primitives; heading/card font weights share one font-aware adapter. Add a typed variant for a genuine difference instead of cloning a control. Card-tool geometry and palette swatches remain domain-specific.

Preset dropdowns separate the current value from selectable options. Overridden spacing shows its actual gap and padding percentages in the trigger rather than a disabled Custom menu item. The menu offers only real presets; opening or cancelling it does not change custom values, and detailed sliders remain available under Customize Layout.

Native ranges, color pickers, file inputs and Reset checkboxes are deliberate exceptions, preserving browser interaction and existing form semantics. Shared sliders show a circular keyboard-focus ring around the thumb, not the whole input, matching toggles with a 2px outline and 2px gap. Reserved edge space keeps the ring visible at minimum and maximum values without changing control dimensions; pointer interaction does not show the ring. Native range dragging and keyboard semantics remain intact. Browser-specific track/thumb CSS supplies the circular rendering while preserving filled-track feedback. Enabled radio choices remain reachable with Tab and support arrow-key selection even when the selected choice is native-disabled. Selected tabs retain native `disabled` through one shared keyboard adapter: Headless UI's TabGroup normalizes away native-disabled selections. Modal layout variants keep one Headless UI focus/lock/exit lifecycle, and shared Motion fade/collapse/chevron timing respects reduced motion. Dropdowns use Headless UI transition/dismissal behavior with the same popup timing. Native control defaults belong in Tailwind's base layer, not unlayered rules that compete with component utilities. Textarea scrollbar integration remains separate because OverlayScrollbars does not support initializing a textarea directly.

The brand link draws keyboard focus only around its rounded icon while keeping the full link actionable. Focused slider thumbs mask the track with the surrounding surface color so it does not show through their focus-ring gap.

The header's Export grid button opens one dialog with format, resolution, quality, output dimensions and a Download image action. Export options persist across reloads; quality adjustment is shown only for JPEG and WebP, not lossless PNG. Settings are grouped into Canvas, Heading and Card style. Canvas style contains Background, Padding and one shared Gap between the heading/grid and between cards. Fonts, weights, colors and sizes are adjusted directly. Reset starts without a selection and reviews the chosen options before confirmation. Dialogs scroll at the viewport edge and keep the background locked through their exit animations. Touch devices focus a non-input control rather than opening the keyboard automatically.

The full-width header keeps Export grid and the desktop sidebar toggle at the top right. Reset is an icon-only trigger after Design, with an accessible label and explanatory tooltip. It is unavailable during image imports, export and revision conflicts. Row and column controls remain in the canvas resize frame. The Gridz icon and title sit at the header's left when they fit, otherwise moving into the right aside below the header. The only sidebar close button stays in the main header.

The Reset dialog offers directly combinable checkboxes for Clear board content, New empty 2x2 grid, Restore appearance and Clear library. Checkboxes start unchecked on every opening. Board-content clearing keeps dimensions, appearance and library; a new grid also restores dimensions. The always-visible appearance selector can restore the current palette or Ink defaults without changing content, dimensions, library or export settings; changing it does not implicitly select Appearance. Library clearing keeps referenced board images but hides them from the library, deleting unused media. Reset selected opens a review with just the Reset heading and a bullet list of all four options: selected options use normal text and unselected options are grayed out. The appearance item includes its chosen palette; descriptions and impact counts are not repeated. Confirm reset applies the chosen combination, while Back restores the selections without changing the document. Selecting every group with Ink defaults also restores export defaults and uses an explicit Delete images and reset everything confirmation. Cancel, Escape and closing make no document changes. Successful execution closes the dialog and returns focus to Reset. Document changes and blob deletions commit transactionally; failed saves retain stored data and object URLs until a retry succeeds. Uploads and placements survive viewport changes, and touch dialogs and panel navigation do not autofocus text inputs.

Settings select portrait (3:4), landscape (4:3), or square (1:1) image tiles independently of row/column counts. Captions remain directly editable above, below, or on the image. On-image captions support top or bottom alignment and adjustable overlay color/opacity. Overlay bands reserve only the text rows that fit within the image's height limit at the selected font size, so captions with the same visible line count have matching bands. Preview and export share tile/caption geometry; style changes retain images and text. Reset restores square tiles with bottom-overlay captions. Thin overlay handles live at the dotted workspace edges: wheel or finger scrolling moves the grid heading and items together as canvas content, while column controls remain fixed vertically. Row buttons follow the last grid row in the scrollable content: scroll down to reach them, without a floating overlay or a reserved strip below the visible rows. Resize buttons have the same 8px gap to the canvas and the outer frame edge, without extra space reserved for an absent scrollbar at the scroll limit. Card touch gestures still move images; the surrounding dotted area supports native panning.

Images always fill their tile. Crop image opens a fullscreen `react-easy-crop` editor with the current tile ratio, mouse/touch/keyboard panning, zoom, guides and reset. Apply saves validated normalized coordinates per cell; Cancel leaves the saved crop unchanged. Reopening restores the crop, and the grid and export use the same source rectangle, including after ratio changes. The original image file is never cropped or replaced, so reused images can have independent crops and can always be cropped differently later. Crop image is also available on library images and in the image picker. A library crop is saved as the default for new placements, including drag-and-drop; existing canvas cards and removed cells keep their own crops. Cancel leaves the saved crop unchanged.

Font, format and resolution dropdowns share a Headless UI listbox with 44px controls and viewport-edge clearance. Font-family menus are alphabetical and preview each face in both options and triggers at 20px, with reduced vertical padding only for those menus. Heading and Card style each have a separate font-weight slider: Manrope supports 100 through 900 in 100-point steps; display fonts offer Regular (400) and browser-synthesized Bold (700). The selected weight affects previews, text measurement and exports, persists across reloads, and resets to 400. Background has a 64x44 color-picker target and a separate editable hex textbox. Six-digit hex accepts an optional `#`; valid edits update the grid, while incomplete/invalid text reverts on blur or Escape. Picker and text changes stay synchronized.

The modal structure was adapted from the user's Chatter frontend; Gridz retains its own Motion transitions, editor styling and deployment. The old native-scrollbar width probes and modal offsets have been removed. A shared OverlayScrollbars initializer covers the workspace, sidebar, compact strips, modal frames and dropdowns without replacing their native scroll elements or wrapping React children. Every scroll area keeps its rails in a stationary sibling frame matched to its viewport, so fast panning does not require scroll-offset compensation. Rail interactions keep dropdowns open, while ordinary outside clicks still dismiss them. Wheel, touch, keyboard and programmatic scrolling remain native; mouse and pen can drag the overlay handles. Touch indicators do not intercept finger panning. Library CSS is imported in the components layer so Tailwind positioning and overflow utilities retain precedence. No Chatter backend code is included.

Development order and progress are tracked in [docs/roadmap.md](docs/roadmap.md). Uploaded fonts/thumbnails and additional/custom ratios remain pending. Dexie stores local-upload blobs and the coherent local grid/reference snapshot in IndexedDB (`grids-client-v1`); localStorage holds the settings cache (`grids-settings-v1`) and separate navigation preferences (`grids-ui-v1`). Restoration uses strict Zod validation and fresh blob URLs for local uploads. Obsolete prototype localStorage documents are ignored, without migration or backup UI.

Navigation survives reloads through browser-local preferences without adding panel parameters to the URL. Browser Back/Forward restores panels using session-history state while keeping the address unchanged. Legacy panel links are imported once and cleaned from the address; unrelated query parameters and fragments are preserved. Old provider preferences and links cannot hide the user's own images or enable provider searches.

Browser-local navigation preferences remember the Images/Design panel, sidebar visibility and preview zoom separately from document/settings saves. The same header toggle opens or closes the right sidebar and bottom panel, with its icons rotated for the bottom layout. Visibility survives reloads and layout changes, and closing the bottom panel returns its space to the canvas. Reset does not add a navigation entry. The composed theme is part of the grid's saved style, not a named selection. Invalid or unavailable preference storage falls back safely; session-history state still supports Back/Forward and reloads in the current tab. Reset/crop/export/image-picker dialogs never reopen automatically, and touch text inputs are not focused on restoration.

The image library and cell picker show **My images** directly, with upload, placement and deletion controls and no source dropdown or online search. Mouse/touch library drops copy images into the targeted cell; direct file drops upload them. Local uploads, captions, crops and grid settings survive reloads. Previously imported supported provider references remain usable without offering new searches/imports; [legacy provider compatibility](docs/providers.md) is retained for those references. Themes requests no sample images. Defaults use Manrope and do not infer branding from the grid name or uploaded images. Artwork used by browser tests lives only in test fixtures, outside public builds.

The shared model separates layout/style/export settings from cell content and media. Its strict settings-only representation excludes images, font files, URLs/paths, placements, IDs, grid names, headings and captions. Private and public presets use this contract on both client and server. Saved grids have a separate reference-only contract. Applying settings validates before changing the grid and preserves local content, including cells outside the visible grid. Reset uses this shared path, with an explicit reset of the grid name and banner text.

All editor document changes use typed commands and a React reducer: grid/cell/export edits, placement/swaps/clearing, resizing/reset, and completed imports. Commands resolve current cell IDs rather than stale positions; resize/reset prepare new-cell IDs before dispatch so replay stays stable. Dialogs, save/export progress and pending image decoding remain outside the saved document. There is no undo feature.

## Deploy To Cloudflare Pages

The Git-connected Cloudflare Pages project is `gridz`, at **https://gridz.pages.dev/**. Production builds follow `main` in `incrementish/grids`, using repository root, Node 22, build command `npm run build:web` and output `apps/web/dist`. GitHub Actions independently runs builds, model/browser tests and API/Postgres tests; it no longer publishes a second GitHub Pages site. Pages deploys successful builds without waiting for those independent tests.

Renaming a Pages project does not change its assigned `pages.dev` subdomain. The previous project, now named `grids`, still owns `gritz.pages.dev`; the `gridz` project was created separately to obtain the correct address. Keep the legacy site available for recovering browser-local drafts/uploads rather than redirecting users away from their old origin.

Root [functions/api/[[path]].ts](functions/api/[[path]].ts) forwards only `/api` requests to the fixed Oracle upstream. All browser API calls remain same-origin; do not set `VITE_API_URL` to the DuckDNS host. This preserves secure SameSite=Lax cookies without relying on third-party cookies. Functions stream API JSON and redirects, never image files. [wrangler.jsonc](wrangler.jsonc) defines public production bindings. Set `GRIDS_PROXY_SECRET` as a **production-only encrypted Pages secret**, identical to the API secret. Preview builds are disabled and the function independently rejects other origins; do not give previews production secrets. Use separate infrastructure/secrets for preview accounts.

The isolated Oracle stack is `/opt/grids`, Compose project `grids-prod`. Its private Postgres volume is separate from Chatter's database; neither Gridz container publishes a host port. Only the API additionally joins `chatter-prod_default` under alias `grids-api`. Chatter's API-host Caddy block imports `extras/*.caddy`; [deploy/caddy/grids.caddy](deploy/caddy/grids.caddy) owns only `/grids-api/*`. It forwards the trusted Pages client-IP header; all API endpoints except read-only health require the shared secret before rate limiting/session handling.

### Oracle Deployment

1. Copy the tracked repository files to `/opt/grids`, without copying local `.env`, `node_modules` or browser uploads. Keep server secrets, backups and volumes between releases.
2. With `umask 077`, copy [deploy/stack.env.example](deploy/stack.env.example) to `deploy/stack.env` and [deploy/api.env.example](deploy/api.env.example) to `deploy/api.env`. Generate independent database and proxy secrets with `openssl rand -hex 32`. Never commit these files. The stack password must remain hexadecimal because Compose constructs `DATABASE_URL` from it.
3. Ensure Chatter's tracked API Caddy block has `import extras/*.caddy`. Its deploy copies files without deleting the unmanaged `extras` directory, preserving Gridz routing.
4. Run `TAG=<release-id> bash deploy/deploy.sh`. It builds the ARM-compatible non-root API image, backs up an already-running Gridz database before migration, waits for both containers to be healthy, validates Caddy and reloads only Caddy. It does not restart Chatter's application or database containers.
5. Upload the proxy secret to Pages without displaying it: `npm exec -- wrangler pages secret put GRIDS_PROXY_SECRET --project-name gridz`. Set it only for production in the dashboard/API. Redeploy Pages after changing secrets or function bindings.

The API applies transactional migrations on startup. Protected SQL backups are stored in `/opt/grids/backups`; copy them to separate protected storage, define retention and test restoration before relying on them. A named volume alone is not a backup. Request-rate limits are process-local; keep one API process until introducing a shared limiter.

### Production Login Providers

Create separate provider applications and put their paired credentials only in `/opt/grids/deploy/api.env`, then recreate the API with `docker compose --env-file deploy/stack.env -f docker-compose.prod.yml up -d --wait api`. Unconfigured providers remain hidden.

- Google: `https://gridz.pages.dev/api/auth/google/callback`
- Facebook: `https://gridz.pages.dev/api/auth/facebook/callback`
- Discord: `https://gridz.pages.dev/api/auth/discord/callback`

Google's authorized JavaScript origin is `https://gridz.pages.dev`. Register the exact callbacks above and complete each provider's consent/test-user/app-review requirements. Actual provider consent flows require configured credentials and manual checks.

When changing the domain, update `GRIDS_PUBLIC_ORIGIN` in Wrangler, API `WEB_URL`/`PUBLIC_API_URL`, page metadata and all provider-console URLs together, then redeploy both services. Browser drafts/uploads belong to the old origin and do not automatically migrate to a new domain. Local Compose remains development-only.

Review the rights to supplied images before publishing them in a public repository.

## Project Structure

- [apps/web/src/App.tsx](apps/web/src/App.tsx): typed React editor UI, command dispatch and import/download interactions.
- [apps/web/src/components/AccountDialog.tsx](apps/web/src/components/AccountDialog.tsx): sign-in, explicit saves/loads, publishing and account deletion.
- [apps/web/src/components/EditorLayout.tsx](apps/web/src/components/EditorLayout.tsx): responsive editor panels.
- [packages/contracts/model.ts](packages/contracts/model.ts): grid/settings schemas, commands and reducer.
- [packages/contracts/cloud.ts](packages/contracts/cloud.ts): reference-only saved grids, settings-only presets and API response schemas.
- [apps/web/src/storage.ts](apps/web/src/storage.ts): browser-local upload blobs and grid/reference snapshots.
- [apps/web/src/browser/navigation.ts](apps/web/src/browser/navigation.ts): browser-local navigation preferences, session history and legacy URL cleanup.
- [apps/web/src/export.ts](apps/web/src/export.ts): canvas sizing and CORS-aware image exports.
- [apps/web/tests](apps/web/tests): model and browser regression tests and test-only artwork.
- [apps/api/src](apps/api/src): validated configuration, OAuth, sessions and owner-scoped CRUD.
- [apps/api/tests](apps/api/tests): contracts/OAuth tests and isolated real-Postgres integration tests.
- [packages/database](packages/database): Postgres pool and transactional SQL migration runner.
- [docker-compose.yml](docker-compose.yml): local Postgres 16 service and persistent volume.
- [apps/web/vite.config.mjs](apps/web/vite.config.mjs) and [apps/web/playwright.config.mjs](apps/web/playwright.config.mjs): web tooling.
- `.github/workflows/deploy.yml`: independent build and regression checks.

## Editing And Export

Browser saving is automatic, separately from explicit account saves. Local-upload blobs and grid content/references stay in IndexedDB; localStorage holds a settings-only cache and separate navigation preferences. Document saves coalesce edits over 300 ms and attempt a flush when the page becomes hidden. Routine progress and success messages are hidden; save failures, session-only mode and conflicts remain visible. Unsaved or failed edits retain a leave-page warning because abrupt termination can still lose pending changes. Browser storage is not permanent backup or synchronization.

The library begins with an Add images placeholder. On the compact shelf it is always square with readable labels, independently of image shape and captions; desktop and picker placeholders follow the card geometry. Hover a library image on desktop or tap it on mobile to reveal Delete. Individual Delete removes a library entry directly, without confirmation or a trash flow. Images still placed on the canvas remain intact, along with captions and placements, across reloads; their local media stays stored but is no longer offered in the library or image picker. Unused images are deleted transactionally with their metadata, and URLs are revoked only after successful deletion. Failed saves retain the stored snapshot/files for retry. To remove the entire grid and image library together, use the confirmed header reset.

Guest documents carry opaque revision tokens. Saving compares the loaded revision inside the image/document transaction before changing files or the settings cache, so stale tabs cannot silently overwrite newer saves. Successful commits send only the guest document ID and revision through BroadcastChannel; focus/visibility checks cover unavailable or missed notifications. Opening an unchanged saved grid does not create another revision. Restoration reads the document and blobs from one coherent transaction.

Changed in another tab stops this tab's autosaves and displays a persistent warning. Local edits and images remain available for session editing/export; they are not automatically merged or discarded. Reload saved grid requires confirmation before replacing them with the saved version, and Cancel preserves them. Ordinary write failures still retry on subsequent edits; revision conflicts require an explicit reload.

- Add/remove columns and rows with the centered header controls, from 1 to 12 in each direction. Preview cards scale between 128 and 200 CSS pixels wide, scrolling when they cannot fit; export resolution is unchanged. Remaining cells stay at their coordinates. Removing a row or column discards its placements, captions and crops; adding it back creates empty cells, including after reload. Library images are retained. There is no removed-cell tray, individual recovery control, or resize history.
- Reset offers four combinable checkboxes, an appearance selector and one Reset selected button. Review shows one Reset heading and all four options in a bullet list, with unselected options grayed out and no repeated descriptions or impact counts. Full reset restores the empty 2x2 grid, appearance and export defaults while deleting all images. Other combinations preserve unselected data. Cleared content cannot be restored by expanding the grid. Cancel leaves everything unchanged.
- Click or tap the whole empty image placeholder to choose an image. An empty library opens file upload directly; otherwise the picker offers library images and upload. Empty cells have no hover upload tools.
- Drop image files anywhere in the image-library panel to import them without placing them. Drop files or library images into a cell to place them there; drag feedback marks the receiving area. Hover and focus outlines extend outside cards, including the first row below the grid heading or sidebar tabs. GIF uploads are excluded from file pickers and rejected on upload/drop, including renamed GIF files. Hover or tap a library image to reveal its delete control.
- My images contains the user's library images and upload tile, without filler cards, a source dropdown or online search. Legacy provider references retain their existing rights/host validation; see [provider compatibility](docs/providers.md).
- Drag filled cells to swap them, including their crops. Hover or tap a filled image for its available Replace, Crop image and top-right Clear tools, each on a translucent contrasting surface without an opaque tool strip. Replacing or clearing a cell resets its crop; clearing leaves its library image available. Cells are not selected; captions are edited directly in their chosen above/below/on-image position.
- Each placed card owns its optional caption and crop, even when multiple cards use the same library image. Editing one optional caption does not rename the library image or other cards. Library renames leave existing cards unchanged; new placements start with the current library title.
- Attribution-required images from older drafts are removed from the library, canvas and overflow when loaded, with a notification. Other images, captions, crops and settings are retained. Local cleanup is autosaved, account saves exclude unsupported references, and new API writes reject them. Supported image titles use the ordinary editable styling and **Show titles** setting; there are no required-credit bands or footers.
- Set an optional Image heading above the grid, such as Team DC or Team Marvel. It keeps the chosen font size, wraps to at most three lines and truncates with an ellipsis in previews and exports. While editing, an outside scrollbar reveals any additional text; Shift+Enter inserts a line break and Enter finishes editing. Turn off Show heading to export without a banner while retaining the text; an empty heading also omits the banner.
- Adjust Canvas, Heading and Card style directly. Colors and typography are included in exports and saved with the grid.
- Choose Bangers, Bebas Neue, Boogaloo, or Manrope separately for the banner and cell headings, then set each font's weight with its slider.
- Upload additional images, adjust their visual crops, spacing and background. Imports show a spinner and completed-file count in the upload tile on desktop and mobile. Processing yields between files so the editor can update; invalid images are skipped with an error, and loading clears when the batch finishes.
- Export the grid as PNG, JPEG, or WebP. Format, resolution, and quality preferences survive reloads.
- Exports include the optional image heading, images, and cell headings, not editor controls or the grid's workspace name.

The optional legacy comic pairing is Bangers for the image heading and Boogaloo for cell headings, with 0.5px letter spacing. Default grids use Manrope. All fonts are bundled locally. Fonts, icons, and original images stay local; no third-party service receives uploads. Imported files use managed blob URLs and persist as IndexedDB blobs, not base64 strings in localStorage. Preset source tags retain image identity across reloads without storing temporary blob URLs.

Automatic persistence is quiet during normal editing; Save failed and other actionable warnings remain visible. Grid and new-image writes are transactional and serialized; failed saves leave editing/export usable and subsequent edits retry. Unavailable storage or a missing saved image enters Session only mode without overwriting the stored grid. Browser storage is not permanent backup or cross-device synchronization. Canvas exports remain capped at 16 MP on narrow/touch layouts and 32 MP otherwise; choose 150/300 px per image for larger grids. These are initial allocation safeguards, not a guarantee against every device's memory limits.

## Check

```sh
npm run check
npm run test:database
```

The browser tests run against the production build under `/grids/` to verify repository-subpath hosting. They check neutral first launch without demo requests, real drag-and-drop, uploads, grid resizing, autosave/reset/export preferences, invalid-document rejection, storage-failure feedback, responsive usability, caption editing, modal scroll/focus lifecycle, touch-device no-autofocus, and downloaded PNG/JPEG/WebP image pixels. Tests should verify behavior, data safety, accessibility, reachable controls and usable scrolling, not cosmetic application styling: avoid asserting chrome colors, icons, borders, animation frames, exact control sizes or decorative alignment. Rendering and pixel checks for user-selected grid settings, crops and exported content remain functional coverage. Comic-based checks seed test-only fixtures directly into isolated browser storage; fixture artwork is excluded from public builds. The multi-format export check has a larger timeout for image decoding and full-resolution output. Tests also write full-resolution PNGs to `exports/`, which is ignored by Git.

Storage checks use real browser IndexedDB: large blobs and private grid content, settings-only localStorage, fresh object URLs, latest-edit persistence, transaction rollback/retry, unavailable-storage fallback, missing-image overwrite protection, and object-URL disposal. Library deletion checks verify retained canvas/overflow images, unused-blob reclamation, and rollback/retry without premature URL revocation. Tests await completed saves before reload and verify restored content and media identity.

Multi-tab checks cover unchanged tab opening, metadata-only notifications, local edit/export preservation, confirmed/cancelled reload, mobile warning layout, focus/visibility fallback without BroadcastChannel, stale purge/write rejection, simultaneous-writer atomicity, commit-only notifications, revision retry after rollback, and channel disposal.

```sh
npx playwright install chromium
npm test
```

`npm run test:api` runs contract and mocked provider exchanges without Postgres. `npm run test:database` requires `DATABASE_URL` and a running Postgres; it creates and drops an isolated random test schema, never clears application tables, and checks migrations, browser-bound OAuth state, sessions, ownership, stale replacements, public/private visibility, logout and cascading account deletion. Provider-console credentials and actual Google/Facebook/Discord consent screens still require manual deployment checks.

`npm test` builds the app automatically and starts a dedicated preview server on localhost port 5840. That test port must be free; tests never reuse an unrelated project's server.

For focused browser runs, rebuild first after application or CSS changes, then use `npm exec -w @grids/web -- playwright test --project=browser tests/account.spec.mjs`. Playwright's preview server serves `apps/web/dist/`, not source files. In [apps/web/tests/editor.spec.mjs](apps/web/tests/editor.spec.mjs), reuse `openSidebarPanel`, `closeSidebarPanel`, and `selectField` for panel-dependent actions, and `setEditorViewport` before responsive-usability checks. Panel helpers wait for real exit/removal and entry boundaries rather than sleeps. Prefer accessible roles, actual interaction and viewport containment over CSS implementation details or fixed layout offsets. Use `touchTest` for automatic touch-context cleanup and `scrollbarTest` to verify gutter-free scrolling even when the browser would normally use classic scrollbars. Scrollbar visibility tests must establish real overflow first; fitting content intentionally has no handle. Selected choices are natively disabled; keyboard tests must verify that navigation skips them.

## Asset Notices

Font redistribution licenses are bundled alongside the font files. Icons are provided by `lucide-react`. Publisher colors do not include logos in the editor or exports. Supplied character artwork and unused publisher logo files remain subject to their owners' rights; this project does not grant a license to that artwork.
