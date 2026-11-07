import {
  Images,
  LayoutGrid,
  PanelRightClose,
  PanelRightOpen,
  PanelsTopLeft,
  RotateCcw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, useReducedMotion } from "motion/react";
import {
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Button, MotionDiv } from "./ui/controls";
import { ImageTabs } from "./ui/ImageTabs";
import { motionDuration } from "./ui/motion";
import { useEditorState } from "../browser/navigation";

const compactQuery =
  "(width < 640px), (width < 901px) and (aspect-ratio < 7/5)";
function subscribeToViewport(onChange: () => void) {
  const media = window.matchMedia(compactQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function EditorLayout({
  children,
  actions,
  canvasControls,
  status,
  resetPanel,
  onResetOpen,
  resetDisabled = false,
}: {
  actions: ReactNode;
  canvasControls: ReactNode;
  status?: ReactNode;
  resetPanel?: ReactNode;
  onResetOpen?: () => void;
  resetDisabled?: boolean;
  children: [
    (toggle: ReactNode, expanded: boolean) => ReactNode,
    (actions: ReactNode) => ReactNode,
    () => ReactNode,
  ];
}) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const compact = useSyncExternalStore(
    subscribeToViewport,
    () => window.matchMedia(compactQuery).matches,
    () => false,
  );
  const [sidebarOpen, setSidebarOpen] = useEditorState("sidebarOpen");
  const [selectedPanel, setSelectedPanel] = useEditorState("selectedPanel");
  const resetOpened = useEffectEvent(() => onResetOpen?.());
  useLayoutEffect(() => {
    if (selectedPanel === 3) resetOpened();
  }, [selectedPanel]);
  const panelOrder = [0, 2, 3] as const;
  const panelsId = useId();
  const panelScroll = useRef(
    new Map<number, Map<HTMLElement, [number, number]>>(),
  );
  const rememberPanelScroll = () => {
    const aside = document.getElementById(panelsId);
    const panel = document.getElementById(
      `${panelsId}-panel-${panelOrder.indexOf(selectedPanel)}`,
    );
    if (!aside || !panel) return;
    const positions = new Map<HTMLElement, [number, number]>();
    const scrollers = [
      aside,
      aside.querySelector<HTMLElement>("[data-sidebar-panels]"),
      ...panel.querySelectorAll<HTMLElement>("*"),
    ];
    for (const element of scrollers)
      if (element && (element.scrollTop > 0 || element.scrollLeft > 0))
        positions.set(element, [element.scrollTop, element.scrollLeft]);
    panelScroll.current.set(selectedPanel, positions);
  };
  useLayoutEffect(() => {
    const aside = document.getElementById(panelsId);
    if (!aside) return;
    aside.scrollTop = 0;
    const panels = aside.querySelector<HTMLElement>("[data-sidebar-panels]");
    if (panels) panels.scrollTop = 0;
    for (const [element, [top, left]] of panelScroll.current.get(
      selectedPanel,
    ) ?? []) {
      element.scrollTop = top;
      element.scrollLeft = left;
    }
  }, [panelsId, selectedPanel]);
  const headerElement = useRef<HTMLElement>(null);
  const [headerHeight, setHeaderHeight] = useState(76);
  const headerActions = useRef<HTMLDivElement>(null);
  const resizeControls = useRef<HTMLDivElement>(null);
  const controlsInHeader = Boolean(canvasControls);
  const headerBrand = useRef<HTMLDivElement>(null);
  const [brandInHeader, setBrandInHeader] = useState(false);
  const expandedExportSpacing = useRef(0);
  const expandedBrandGap = useRef(0);
  const [compactZoom, setCompactZoom] = useState(false);
  const [compactExport, setCompactExport] = useState(false);
  const [headerLayout, setHeaderLayout] = useState<
    "full" | "icon" | "shifted" | "scroll"
  >("full");
  useLayoutEffect(() => {
    const controls = resizeControls.current;
    const actions = headerActions.current;
    const branding = headerBrand.current;
    const wrapper = controls?.parentElement;
    const exportButton = actions?.querySelector<HTMLButtonElement>(
      "#export-grid-header",
    );
    const label = exportButton?.querySelector("span");
    const icon = exportButton?.querySelector("svg");
    if (
      !controls ||
      !actions ||
      !branding ||
      !wrapper ||
      !exportButton ||
      !label ||
      !icon
    )
      return;
    const measure = () => {
      setHeaderHeight(
        headerElement.current?.getBoundingClientRect().height ?? 76,
      );
      const style = getComputedStyle(exportButton);
      if (!compactExport) {
        expandedExportSpacing.current =
          parseFloat(style.paddingLeft) +
          parseFloat(style.paddingRight) +
          parseFloat(style.borderLeftWidth) +
          parseFloat(style.borderRightWidth) +
          parseFloat(style.columnGap);
      }
      const range = document.createRange();
      range.selectNodeContents(label);
      const fullExportWidth =
        range.getBoundingClientRect().width +
        icon.getBoundingClientRect().width +
        expandedExportSpacing.current;
      const brandLink = branding.querySelector(".brand");
      const brandLabel = branding.querySelector("[data-brand-label]");
      const brandIconWidth =
        branding.querySelector(".brand-mark")?.getBoundingClientRect().width ??
        0;
      if (!compactExport && brandLink)
        expandedBrandGap.current = parseFloat(
          getComputedStyle(brandLink).columnGap,
        );
      const brandRange = document.createRange();
      if (brandLabel) brandRange.selectNodeContents(brandLabel);
      const fullBrandWidth =
        brandIconWidth +
        expandedBrandGap.current +
        brandRange.getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(controls).columnGap);
      const children = [...controls.children];
      const controlsWidth =
        children.reduce(
          (width, child) => width + child.getBoundingClientRect().width,
          0,
        ) +
        gap * Math.max(0, children.length - 1);
      // Width-based so the result does not depend on the current layout mode.
      const headerWidth = headerElement.current?.clientWidth ?? 0;
      const zoneWidth = headerWidth - (!compact && sidebarOpen ? 350 : 0);
      const actionsRight = headerWidth - 12;
      const otherActionsWidth =
        actions.getBoundingClientRect().width -
        exportButton.getBoundingClientRect().width;
      const zoomField = controls.querySelector("#canvas-zoom")?.parentElement;
      const zoomWidth = zoomField?.getBoundingClientRect().width ?? 0;
      const expandedZoomWidth = zoomWidth * (compactZoom ? 2 : 1);
      const fullControlsWidth = controlsWidth + expandedZoomWidth - zoomWidth;
      const fits = (exportWidth: number, width: number) =>
        actionsRight - otherActionsWidth - exportWidth >=
        zoneWidth / 2 + width / 2 + gap;
      const brandFits = (brandWidth: number, width: number) =>
        12 + brandWidth + gap <= zoneWidth / 2 - width / 2;
      const nextCompactExport = window.matchMedia("(width < 450px)").matches;
      const iconWidth = exportButton.getBoundingClientRect().height;
      const exportWidth = nextCompactExport ? iconWidth : fullExportWidth;
      const brandWidth = nextCompactExport ? brandIconWidth : fullBrandWidth;
      const controlsFit = (width: number) =>
        fits(exportWidth, width) && brandFits(brandWidth, width);
      const nextCompactZoom =
        Boolean(zoomField) && !controlsFit(fullControlsWidth);
      const nextControlsWidth =
        fullControlsWidth - (nextCompactZoom ? expandedZoomWidth / 2 : 0);
      const leftControlsRight =
        parseFloat(getComputedStyle(controls).paddingLeft) + nextControlsWidth;
      const nextLayout = fits(exportWidth, nextControlsWidth)
        ? nextCompactExport
          ? "icon"
          : "full"
        : actionsRight - otherActionsWidth - exportWidth >=
            leftControlsRight + gap
          ? "shifted"
          : "scroll";
      setHeaderLayout(nextLayout);
      setCompactZoom(nextCompactZoom);
      setCompactExport(nextCompactExport);
      setBrandInHeader(
        nextLayout !== "shifted" &&
          nextLayout !== "scroll" &&
          brandFits(brandWidth, nextControlsWidth),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [
      headerElement.current,
      wrapper,
      controls,
      actions,
      label,
      branding,
    ])
      if (element) observer.observe(element);
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [
    compact,
    sidebarOpen,
    headerLayout,
    compactZoom,
    compactExport,
    controlsInHeader,
  ]);
  const [library, workspace, themes] = children;
  const brand = (
    <a
      className="brand shrink-0 group-data-compact-export/header:gap-0"
      href="./"
      aria-label="Gridz"
      title="Gridz"
    >
      <span className="brand-mark">
        <PanelsTopLeft />
      </span>
      <span
        data-brand-label
        className="whitespace-nowrap group-data-compact-export/header:sr-only"
      >
        Gridz
      </span>
    </a>
  );
  const canvasActions = (
    <div
      className={`relative flex gap-2 ${headerLayout === "scroll" ? "w-full min-w-0 shrink-0 flex-row items-center pr-3" : "w-full min-w-0 flex-col"}`}
    >
      <div
        ref={headerBrand}
        data-header-brand
        aria-hidden={!brandInHeader}
        inert={!brandInHeader}
        className={`absolute top-1/2 left-3 flex h-11 -translate-y-1/2 items-center ${brandInHeader ? "" : "pointer-events-none invisible"}`}
      >
        {brand}
      </div>
      <div
        ref={resizeControls}
        data-canvas-controls
        data-overlay-scroll={headerLayout === "scroll" ? "x" : "none"}
        className={`flex min-h-11 min-w-0 items-center gap-2 pl-3 ${headerLayout === "scroll" ? "min-w-0 flex-1 flex-nowrap justify-start self-stretch overflow-x-auto overflow-y-hidden bg-ui-panel py-3 pr-3" : `overflow-hidden pr-3 flex-wrap justify-center ${headerLayout === "shifted" ? "justify-start!" : ""} ${!compact && sidebarOpen ? "w-[calc(100%-350px)]" : "w-full"}`}`}
      >
        {canvasControls}
      </div>
      <div
        ref={headerActions}
        role="group"
        aria-label={t("editor.panels")}
        className={`flex items-center gap-2 ${headerLayout === "scroll" ? "relative my-3 shrink-0" : "absolute top-1/2 right-3 -translate-y-1/2"}`}
      >
        {actions}
        {!compact && (
          <Button
            presentation="icon"
            title={t(
              sidebarOpen ? "editor.closeSidebar" : "editor.showSidebar",
            )}
            aria-label={t(
              sidebarOpen ? "editor.closeSidebar" : "editor.showSidebar",
            )}
            aria-expanded={sidebarOpen}
            aria-controls={panelsId}
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? (
              <PanelRightClose aria-hidden="true" className="size-5!" />
            ) : (
              <PanelRightOpen aria-hidden="true" className="size-5!" />
            )}
          </Button>
        )}
      </div>
      {status}
    </div>
  );
  const canvasHeader = (
    <header
      ref={headerElement}
      data-canvas-header
      data-header-layout={headerLayout}
      data-brand-placement={brandInHeader ? "header" : "aside"}
      data-compact-zoom={compactZoom ? true : undefined}
      data-compact-export={compactExport ? true : undefined}
      data-overlay-scroll={headerLayout === "scroll" ? "none" : "x"}
      className={`group/header relative col-span-full flex min-h-19 w-full shrink-0 overflow-y-hidden ${headerLayout === "scroll" ? "items-stretch overflow-x-hidden" : "items-center overflow-x-auto py-3"} border-0 border-b border-solid border-ui-border bg-ui-background [&_button:focus-visible]:-outline-offset-3!`}
    >
      {canvasActions}
    </header>
  );
  return (
    <>
      {canvasHeader}
      {workspace(null)}
      <div
        data-sidebar-track
        data-editor-layout={compact ? "bottom" : "right"}
        data-sidebar-open={!compact && sidebarOpen ? "" : undefined}
        className={
          compact
            ? "relative w-full shrink-0 overflow-hidden"
            : "relative h-full min-h-0 min-w-0 w-full overflow-hidden"
        }
      >
        <AnimatePresence initial={false}>
          {(compact || sidebarOpen) && (
            <MotionDiv
              key={compact ? "sidebar-compact" : "sidebar"}
              initial={compact ? { height: 0 } : { x: "100%" }}
              animate={compact ? { height: "auto" } : { x: 0 }}
              exit={compact ? { height: 0 } : { x: "100%" }}
              motionTransition={{
                duration: reduced ? 0 : motionDuration.layout,
                ease: "easeInOut",
              }}
              className={
                compact
                  ? "overflow-hidden"
                  : "pointer-events-auto absolute inset-y-0 right-0 w-87.5"
              }
            >
              <aside
                id={panelsId}
                data-editor-sidebar
                data-overlay-scroll={compact ? "y" : "none"}
                aria-label={t("editor.tools")}
                className={`min-h-0 min-w-0 w-full border-0 border-solid border-ui-border bg-ui-panel ${compact ? "flex h-[min(150px,30dvh)] flex-row items-start overflow-x-hidden overflow-y-auto overscroll-contain border-t [--shelf-content-height:149px]" : "flex h-full flex-col overflow-hidden border-l"}`}
              >
                <div
                  data-sidebar-sticky
                  className={`z-20 shrink-0 bg-ui-panel ${compact ? "relative h-(--shelf-content-height) w-11" : "sticky top-0"}`}
                >
                  {!brandInHeader && !compact && (
                    <div
                      data-sidebar-brand
                      className="flex min-h-19 items-center border-0 border-b border-solid border-ui-border px-4 py-3"
                    >
                      {brand}
                    </div>
                  )}
                  {
                    <div
                      data-panel-controls
                      data-overlay-scroll="none"
                      className={`flex shrink-0 flex-col gap-2 ${compact ? "h-full **:[[role=tab]]:border-l-0! [&_[role=tab]:first-child]:border-t-0! [&_[role=tab]:last-child]:border-b-0!" : "**:[[role=tab]]:border-t-0! [&_[role=tab]:first-child]:border-l-0! [&_[role=tab]:last-child]:border-r-0!"}`}
                    >
                      <ImageTabs
                        id={panelsId}
                        square
                        vertical={compact}
                        label={t("editor.panels")}
                        selectedIndex={panelOrder.indexOf(selectedPanel)}
                        onChange={(index) => {
                          rememberPanelScroll();
                          setSelectedPanel(panelOrder[index]!);
                        }}
                        tabs={[
                          { label: t("editor.images"), icon: Images },
                          { label: t("presets.title"), icon: LayoutGrid },
                          {
                            label: t("editor.reset.title"),
                            title: t("editor.reset.tooltip"),
                            icon: RotateCcw,
                            iconOnly: true,
                            disabled: resetDisabled,
                          },
                        ]}
                      />
                    </div>
                  }
                </div>
                <div
                  data-sidebar-panels
                  data-overlay-scroll={compact ? "none" : "y"}
                  className={`relative isolate z-0 min-w-0 flex-1 ${compact ? "min-h-37.25" : "min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain"} ${selectedPanel === 2 ? "p-0" : "p-3"} **:data-sidebar-header:hidden! [&_.asset-panel]:static! [&_.asset-panel]:block! [&_.asset-panel]:h-auto! [&_.asset-panel]:overflow-visible! [&_.asset-panel]:border-0! **:data-sidebar-content:overflow-visible!`}
                >
                  <div
                    role="tabpanel"
                    id={`${panelsId}-panel-0`}
                    aria-labelledby={`${panelsId}-tab-0`}
                    hidden={selectedPanel !== 0}
                    className="min-h-0"
                  >
                    {library(null, true)}
                  </div>
                  {
                    <div
                      role="tabpanel"
                      id={`${panelsId}-panel-1`}
                      aria-labelledby={`${panelsId}-tab-1`}
                      hidden={selectedPanel !== 2}
                      className="min-h-0"
                    >
                      {themes()}
                    </div>
                  }
                  <div
                    role="tabpanel"
                    id={`${panelsId}-panel-2`}
                    aria-labelledby={`${panelsId}-tab-2`}
                    hidden={selectedPanel !== 3}
                    className="min-h-0"
                  >
                    {resetPanel}
                  </div>
                </div>
              </aside>
            </MotionDiv>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
