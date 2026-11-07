import { t } from "../i18n";
import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { flushSync } from "react-dom";
import { gridLimit } from "../model";
import {
  ArrowDownFromLine,
  ArrowLeftToLine,
  ArrowRightFromLine,
  ArrowUpToLine,
} from "lucide-react";
import { Button, ButtonGroup } from "./ui/controls";

export function GridResizer({
  ref,
  style,
  viewportHeight,
  controlsHeight,
  previewWidth,
  onOverflowChange,
  heading,
  bottomControls,
  sideControls,
  cornerAction,
  leadingSpace = true,
  children,
}: {
  ref?: Ref<HTMLDivElement>;
  style?: CSSProperties;
  viewportHeight?: number;
  controlsHeight?: number;
  previewWidth?: number;
  onOverflowChange?: (size: { width: number; height: number }) => void;
  heading?: ReactNode;
  bottomControls?: ReactNode;
  sideControls?: ReactNode;
  cornerAction?: ReactNode;
  leadingSpace?: boolean;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const content = contentRef.current;
    const viewport = viewportRef.current;
    const area = content?.parentElement;
    if (!content || !viewport || !area) return;
    const workspace = viewport.closest<HTMLElement>("[data-workspace-scroll]");
    const canvasArea = area.parentElement;
    let syncedViewportLeft = viewport.scrollLeft;
    // Frame size beyond the sticky canvas area; reached by scrolling after the board.
    let extra = { width: 0, height: 0 };
    const measureExtra = () => {
      if (!canvasArea) return { width: 0, height: 0 };
      const style = getComputedStyle(canvasArea);
      return {
        width: Math.max(
          0,
          area.offsetWidth -
            (canvasArea.clientWidth -
              parseFloat(style.paddingLeft) -
              parseFloat(style.paddingRight)),
        ),
        height: Math.max(
          0,
          area.offsetHeight -
            (canvasArea.clientHeight -
              parseFloat(style.paddingTop) -
              parseFloat(style.paddingBottom)),
        ),
      };
    };
    const syncViewport = () => {
      if (!workspace) return;
      viewport.scrollLeft = workspace.scrollLeft;
      viewport.scrollTop = 0;
      syncedViewportLeft = viewport.scrollLeft;
      const x = Math.min(
        extra.width,
        workspace.scrollLeft - viewport.scrollLeft,
      );
      const y = Math.min(extra.height, workspace.scrollTop);
      area.style.translate = x > 0 || y > 0 ? `${-x}px ${-y}px` : "";
      area.style.setProperty("--frame-shift-y", `${y > 0 ? y : 0}px`);
    };
    const syncWorkspace = () => {
      if (!workspace) return;
      if (viewport.scrollLeft !== syncedViewportLeft) {
        workspace.scrollLeft = viewport.scrollLeft;
        syncedViewportLeft = viewport.scrollLeft;
      }
      if (viewport.scrollTop !== 0) viewport.scrollTop = 0;
    };
    const update = () => {
      extra = measureExtra();
      const viewportOverflowWidth = Math.max(
        0,
        viewport.scrollWidth - viewport.clientWidth,
      );
      const overflow = {
        width: viewportOverflowWidth + extra.width,
        height: extra.height,
      };
      viewport.toggleAttribute("data-overflow-x", viewportOverflowWidth > 0);
      if (
        overflow.width !== overflowRef.current.width ||
        overflow.height !== overflowRef.current.height
      ) {
        overflowRef.current = overflow;
        onOverflowChange?.(overflow);
      }
    };
    update();
    // Flush before paint so the stale scroll extent never flashes scrollbars.
    const observer = new ResizeObserver(() => flushSync(update));
    observer.observe(content);
    observer.observe(viewport);
    observer.observe(area);
    if (canvasArea) observer.observe(canvasArea);
    if (viewport.firstElementChild)
      observer.observe(viewport.firstElementChild);
    workspace?.addEventListener("scroll", syncViewport, { passive: true });
    viewport.addEventListener("scroll", syncWorkspace, { passive: true });
    syncViewport();
    return () => {
      observer.disconnect();
      workspace?.removeEventListener("scroll", syncViewport);
      viewport.removeEventListener("scroll", syncWorkspace);
    };
  }, [viewportHeight, previewWidth, onOverflowChange]);
  return (
    <div
      ref={ref}
      style={style}
      data-resize-frame
      data-controls-placement={bottomControls ? "canvas" : "header"}
      data-balanced-controls={leadingSpace || undefined}
      className={
        bottomControls
          ? `grid min-h-0 min-w-0 ${leadingSpace ? "grid-cols-[44px_minmax(0,1fr)_44px] gap-2 pb-2" : "grid-cols-[minmax(0,1fr)_44px] gap-2 pr-2 pb-2"} grid-rows-[minmax(0,1fr)_44px] [&_button:focus-visible]:-outline-offset-3!`
          : "flex min-h-0 min-w-0 items-center justify-center"
      }
    >
      <div
        ref={contentRef}
        data-preview-content
        style={{
          width: previewWidth,
          maxWidth: "100%",
          paddingTop: 0,
        }}
        className={`relative isolate flex min-w-0 flex-col @container shadow-ui-canvas ${bottomControls ? `${leadingSpace ? "col-start-2" : "col-start-1"} row-start-1` : ""}`}
      >
        <span
          aria-hidden="true"
          data-image-canvas-background
          className="pointer-events-none absolute inset-0 -z-10 bg-(--board-bg)"
        />
        {heading && (
          <div className="relative z-10 px-(--canvas-inset,0px) pt-(--canvas-inset,0px) pb-(--heading-gap,0px)">
            {heading}
          </div>
        )}
        <div
          ref={viewportRef}
          data-canvas-viewport
          className="relative z-20 min-w-0 overflow-hidden [clip-path:inset(0px_var(--clip-x,-100vmax)_-100vmax_var(--clip-x,-100vmax))] data-overflow-x:[--clip-x:var(--canvas-feedback-space)]"
          style={
            {
              height: viewportHeight,
              boxSizing: "content-box",
              "--canvas-feedback-space":
                "calc(var(--preview-cell-width, 200px) * 0.03 + 2px)",
              padding: "var(--canvas-feedback-space)",
              margin: "calc(-1 * var(--canvas-feedback-space))",
            } as CSSProperties
          }
        >
          {children}
        </div>
      </div>
      {bottomControls && (
        <>
          <div
            style={{ height: controlsHeight }}
            className={`${leadingSpace ? "col-start-3" : "col-start-2"} row-start-1 flex items-center justify-center translate-y-(--frame-shift-y,0px)`}
          >
            {sideControls}
          </div>
          <div
            className={`${leadingSpace ? "col-start-2" : "col-start-1"} row-start-2 flex items-center justify-center`}
          >
            {bottomControls}
          </div>
          <div
            className={`${leadingSpace ? "col-start-3" : "col-start-2"} row-start-2 flex items-center justify-center`}
          >
            {cornerAction}
          </div>
        </>
      )}
    </div>
  );
}

export function GridResizeControls({
  rows,
  columns,
  onResize,
  dimension,
  orientation = "horizontal",
}: {
  rows: number;
  columns: number;
  onResize: (dimension: "rows" | "columns", value: number) => void;
  dimension?: "rows" | "columns";
  orientation?: "horizontal" | "vertical";
}) {
  const dimensions = { rows, columns };
  return (
    <>
      {(dimension ? [dimension] : (["columns", "rows"] as const)).map(
        (dimension) => (
          <ButtonGroup
            key={dimension}
            label={
              dimension === "columns"
                ? t("editor.resize.columns")
                : t("editor.resize.rows")
            }
            orientation={orientation}
          >
            {[-1, 1].map((change) => {
              const label = `${change > 0 ? "Add" : "Remove"} ${dimension === "columns" ? "column" : "row"}`;
              const limited =
                change > 0
                  ? dimensions[dimension] >= gridLimit
                  : dimensions[dimension] <= 1;
              const limit =
                change > 0
                  ? `Maximum ${gridLimit} ${dimension}`
                  : `Minimum one ${dimension === "columns" ? "column" : "row"}`;
              return (
                <Button
                  key={change}
                  presentation="icon"
                  aria-label={label}
                  title={limited ? limit : label}
                  data-resize-action={change > 0 ? "add" : "remove"}
                  disabled={limited}
                  onClick={() =>
                    onResize(dimension, dimensions[dimension] + change)
                  }
                >
                  {(() => {
                    const Icon =
                      dimension === "columns"
                        ? change > 0
                          ? ArrowRightFromLine
                          : ArrowLeftToLine
                        : change > 0
                          ? ArrowDownFromLine
                          : ArrowUpToLine;
                    return <Icon aria-hidden="true" className="size-6!" />;
                  })()}
                </Button>
              );
            })}
          </ButtonGroup>
        ),
      )}
    </>
  );
}
