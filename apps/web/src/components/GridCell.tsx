import { t } from "../i18n";
import { captionMaxLength } from "../config";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { cva } from "class-variance-authority";
import { Check, Crop, ImagePlus, Move, Trash2 } from "lucide-react";
import type { ProviderImage } from "../providers";
import { useDrag } from "@use-gesture/react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
} from "react";
import {
  cellGeometry,
  captionPadding,
  resolveFontWeight,
  publishers,
  sourceRectangle,
  type ImageCrop,
  type Asset,
  type Cell,
  type CellPatch,
  type GridStyle,
} from "../model";
import { layoutCaption } from "../export";
import { Button, Spinner } from "./ui/controls";
import { CropEditor } from "./CropEditor";
import { CardBorder, CardFrame } from "./CardFrame";
import { centerTextArea, TextScrollbar } from "./TextScrollbar";
import { contrastingColor } from "../canvasTheme";

const cardToolButtonStyles = cva(
  "pointer-events-auto absolute p-0! rounded-[2cqw]! border-white/30! bg-black/60! text-white [--control-hover-base:color-mix(in_srgb,black_60%,var(--card-background))] enabled:hover:control-hover! [&_svg]:size-[40%]!",
  {
    variants: {
      position: {
        topLeft: "left-(--card-tool-inset) top-(--card-tool-top-inset)",
        topRight: "right-(--card-tool-inset) top-(--card-tool-top-inset)",
        bottomLeft:
          "left-(--card-tool-inset) bottom-(--card-tool-bottom-inset)",
        bottomRight:
          "right-(--card-tool-inset) bottom-(--card-tool-bottom-inset)",
      },
      size: {
        proportional: "size-[min(25cqw,var(--cell-tool-space))]!",
        fixed: "size-11! max-[901px]:size-6!",
      },
      dragHandle: {
        true: "touch-none",
        false: "backdrop-blur-sm",
      },
    },
    defaultVariants: { size: "proportional", dragHandle: false },
  },
);

const coarsePointerQuery = "(pointer: coarse)";
function subscribeToPointer(onChange: () => void) {
  const media = window.matchMedia(coarsePointerQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useCoarsePointer() {
  return useSyncExternalStore(
    subscribeToPointer,
    () => window.matchMedia(coarsePointerQuery).matches,
    () => false,
  );
}

export type CardDragSource =
  | { kind: "cell"; gridId: string; cellId: string }
  | { kind: "asset"; assetId: string }
  | { kind: "provider"; image: ProviderImage };

export type CardDragVisual = {
  cell: Cell;
  asset: Asset;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
};

export function GridCell({
  cell,
  asset,
  index,
  gridId,
  gridStyle,
  position,
  onPatch,
  onCrop,
  onClear,
  onChoose,
  onUpload,
  onDrop,
  canChoose,
  library,
  captionRows = 1,
  onMoveStart,
  onTouchDrag,
  onMoveOver,
  onMoveLeave,
  moving = false,
  dragAffected = false,
  dragSource = false,
  previewOnly = false,
  importing = false,
}: {
  cell: Cell;
  asset?: Asset;
  index: number;
  gridId: string;
  gridStyle: GridStyle;
  position?: { row: number; column: number };
  onPatch: (patch: CellPatch) => void;
  onCrop?: (crop: ImageCrop, assetId: string) => void;
  onClear: () => void;
  onChoose: (trigger: HTMLButtonElement) => void;
  onUpload: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  canChoose: boolean;
  library?: {
    onDelete: () => void;
    disabled: boolean;
    onSelect?: () => void;
    source?: CardDragSource;
  };
  captionRows?: number;
  onMoveStart?: (source: CardDragSource, visual: CardDragVisual) => void;
  onTouchDrag?: (
    source: CardDragSource,
    visual: CardDragVisual,
    finished: boolean,
    cancelled: boolean,
  ) => void;
  onMoveOver?: () => void;
  onMoveLeave?: () => void;
  moving?: boolean;
  dragAffected?: boolean;
  dragSource?: boolean;
  previewOnly?: boolean;
  importing?: boolean;
}) {
  const coarsePointer = useCoarsePointer();
  const dropPlaceholder = !asset && !library;
  const cardBackground = dropPlaceholder
    ? contrastingColor(
        gridStyle.background,
        gridStyle.cellBackgroundColor ?? "#111315",
        1.5,
      )
    : (gridStyle.cellBackgroundColor ?? "#111315");
  const frameBackground = dropPlaceholder
    ? cardBackground
    : gridStyle.background;
  const selectsLibraryImage = Boolean(
    coarsePointer && library?.onSelect && asset?.provenance,
  );
  const primaryActionLabel = selectsLibraryImage
    ? t("cell.actions.useImage", { value1: asset?.title })
    : library
      ? t("cell.actions.deleteImage")
      : t("cell.actions.clear");
  const trigger = useRef<HTMLButtonElement>(null);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [loadedImage, setLoadedImage] = useState<string | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const caption = useRef<HTMLTextAreaElement>(null);
  const [captionFocused, setCaptionFocused] = useState(false);
  const [overlayCaptionRows, setOverlayCaptionRows] = useState(1);
  const dragPreview = useRef<HTMLCanvasElement | null>(null);
  const touchDragged = useRef(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const touchTapped = useRef(false);
  const bindTouchDrag = useDrag(
    ({ xy, initial, last, canceled, tap, event, args }) => {
      if (tap || !asset || !card.current || !onTouchDrag) return;
      if ("pointerType" in event && event.pointerType !== "touch") return;
      touchDragged.current = true;
      setImageHovered(false);
      setHoverTools(false);
      const bounds = card.current.getBoundingClientRect();
      const notify = () =>
        onTouchDrag(
          library
            ? (library.source ?? { kind: "asset", assetId: asset.id })
            : { kind: "cell", gridId, cellId: cell.id },
          {
            cell,
            asset,
            width: bounds.width,
            height: bounds.height,
            offsetX: initial[0] - bounds.left,
            offsetY: initial[1] - bounds.top,
            x: xy[0],
            y: xy[1],
          },
          last,
          canceled ||
            event.type === "pointercancel" ||
            event.type === "touchcancel",
        );
      if (
        last ||
        canceled ||
        event.type === "pointercancel" ||
        event.type === "touchcancel"
      ) {
        requestAnimationFrame(() => {
          notify();
          (args[0] as (() => void) | undefined)?.();
        });
      } else notify();
    },
    {
      enabled:
        coarsePointer &&
        Boolean(asset && onTouchDrag) &&
        !library?.disabled &&
        !library?.onSelect &&
        !previewOnly,
      threshold: 8,
      filterTaps: true,
      pointer: { keys: false },
    },
  );
  useEffect(() => () => dragPreview.current?.remove(), []);
  const [cropTarget, setCropTarget] = useState<string | null>(null);
  const [imageHovered, setImageHovered] = useState(false);
  const [hoverTools, setHoverTools] = useState(false);
  const touchOpenedAt = useRef(0);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!imageHovered) return;
    const clearOutsideHover = (event: PointerEvent) => {
      if (
        event.pointerType === "mouse" &&
        !card.current
          ?.querySelector("[data-card-image]")
          ?.contains(event.target as Node)
      ) {
        setImageHovered(false);
        setHoverTools(false);
      }
    };
    window.addEventListener("pointermove", clearOutsideHover);
    return () => window.removeEventListener("pointermove", clearOutsideHover);
  }, [imageHovered]);
  useEffect(() => {
    if (cropTarget && cropTarget !== asset?.id) setCropTarget(null);
  }, [asset?.id, cropTarget]);
  const geometry = cellGeometry(
    gridStyle,
    600,
    asset
      ? Math.min(
          3,
          gridStyle.captionPlacement === "overlay"
            ? overlayCaptionRows
            : captionRows,
        )
      : 0,
  );
  const cropRectangle =
    cell.crop && imageSize.width && imageSize.height
      ? sourceRectangle(
          cell.crop,
          imageSize.width,
          imageSize.height,
          geometry.aspectRatio,
        )
      : null;
  const overlay = gridStyle.captionPlacement === "overlay";
  const alignment = gridStyle.captionAlignment ?? "bottom";
  const toolTop =
    overlay && alignment === "top"
      ? Math.min(
          geometry.imageHeight,
          Math.max(
            0,
            geometry.captionTop + geometry.captionHeight - geometry.imageTop,
          ),
        )
      : 0;
  const toolBottom =
    overlay && alignment === "bottom"
      ? geometry.imageHeight -
        Math.min(
          geometry.imageHeight,
          Math.max(0, geometry.captionTop - geometry.imageTop),
        )
      : 0;
  const freeImageHeight = Math.max(
    0,
    geometry.imageHeight - (overlay ? geometry.captionHeight : 0),
  );
  const toolSpace =
    overlay && alignment === "middle" ? freeImageHeight / 2 : freeImageHeight;
  const overlayColor = `${gridStyle.captionOverlayColor ?? "#000000"}${Math.round(
    ((gridStyle.captionOverlayOpacity ?? 60) / 100) * 255,
  )
    .toString(16)
    .padStart(2, "0")}`;
  const captionStyle = {
    top:
      overlay && alignment === "bottom"
        ? "auto"
        : `${(geometry.captionTop / geometry.height) * 100}%`,
    bottom: overlay && alignment === "bottom" ? 0 : undefined,
    height: `${(geometry.captionHeight / geometry.height) * 100}%`,
    background: overlay
      ? overlayColor
      : (gridStyle.cellBackgroundColor ??
        publishers[gridStyle.publisher].caption),
    "--card-caption-color": overlay
      ? overlayColor
      : (gridStyle.cellBackgroundColor ??
        publishers[gridStyle.publisher].caption),
    fontFamily: `"${gridStyle.cellFont}", sans-serif`,
    fontWeight: resolveFontWeight(gridStyle.cellFont, gridStyle.cellFontWeight),
    color: gridStyle.cellTextColor ?? "#f4f4ef",
    margin: 0,
    letterSpacing: 0,
  } as React.CSSProperties;
  const captionVisible =
    Boolean(asset) &&
    gridStyle.titlesVisible !== false &&
    geometry.captionHeight > 0;
  useLayoutEffect(() => {
    const field = caption.current;
    if (!field || !captionVisible) return;
    let disposed = false;
    const context = overlay
      ? document.createElement("canvas").getContext("2d")
      : null;
    const fit = (entries?: ResizeObserverEntry[]) => {
      if (disposed) return;
      const box = entries?.[0]?.borderBoxSize?.[0];
      const bounds = box
        ? { width: box.inlineSize, height: box.blockSize }
        : field.getBoundingClientRect();
      const padding = captionPadding(bounds.width);
      const fontSize = Math.min(
        (bounds.width * (gridStyle.cellFontSize ?? 12)) / 100,
        Math.max(0, (bounds.height - padding.vertical * 2) / 1.05),
      );
      field.style.fontSize = `${fontSize}px`;
      field.style.padding = `${padding.vertical}px ${padding.horizontal}px`;
      if (document.activeElement === field) centerTextArea(field);
      field.parentElement?.style.setProperty(
        "--library-caption-font-size",
        `${fontSize}px`,
      );
      field.parentElement?.style.setProperty(
        "--library-caption-padding",
        `${padding.vertical}px ${padding.horizontal}px`,
      );
      field.parentElement?.style.setProperty(
        "--library-caption-lines",
        String(
          fontSize > 0
            ? Math.max(
                1,
                Math.min(
                  3,
                  Math.floor(
                    (bounds.height - padding.vertical * 2) / (fontSize * 1.05),
                  ),
                ),
              )
            : 3,
        ),
      );
    };
    const fitText = () => {
      if (disposed) return;
      if (context)
        setOverlayCaptionRows(
          Math.min(
            3,
            layoutCaption(
              context,
              cell.title || "Add heading",
              gridStyle.cellFont,
              600,
              gridStyle.cellFontSize,
              resolveFontWeight(gridStyle.cellFont, gridStyle.cellFontWeight),
            ).lines.length,
          ),
        );
      fit();
    };
    const observer = new ResizeObserver(fit);
    observer.observe(field);
    void Promise.all([
      document.fonts.ready,
      document.fonts.load(
        `${resolveFontWeight(gridStyle.cellFont, gridStyle.cellFontWeight)} 48px "${gridStyle.cellFont}"`,
      ),
    ]).then(fitText);
    fitText();
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [
    captionVisible,
    cell.title,
    gridStyle.cellFont,
    gridStyle.cellFontSize,
    gridStyle.cellFontWeight,
    geometry.height,
    geometry.captionTop,
    geometry.captionHeight,
    overlay,
  ]);
  return (
    <Popover
      ref={card}
      className={`image-card @container relative min-w-0 border-0! -outline-offset-2 [--card-frame-color:transparent] data-image-hovered:[--card-frame-color:var(--card-frame-hover-color)] has-[[data-card-image]_button:focus-visible]:[--card-frame-color:var(--card-frame-hover-color)] ${previewOnly ? "drag-preview-card h-full w-full" : library ? `asset ${library.onSelect ? "cursor-pointer" : "cursor-move"} w-full!` : "grid-cell"}${!library && dragAffected && !dragSource ? " drag-over" : ""}`}
      style={
        {
          aspectRatio: `600 / ${geometry.height}`,
          "--card-radius": `${gridStyle.cornerRadius ?? 12.5}cqw`,
          borderRadius: `${gridStyle.cornerRadius ?? 12.5}% / ${((gridStyle.cornerRadius ?? 12.5) * 600) / geometry.height}%`,
          "--card-background": cardBackground,
          "--card-placeholder-color": contrastingColor(
            cardBackground,
            "#eef1f3",
          ),
          "--card-frame-hover-color": contrastingColor(
            frameBackground,
            dropPlaceholder
              ? cardBackground
              : (gridStyle.cellTextColor ?? "#eef1f3"),
            3,
          ),
          "--card-drop-color": contrastingColor(
            frameBackground,
            dropPlaceholder
              ? cardBackground
              : (gridStyle.cellTextColor ?? "#eef1f3"),
            3,
          ),
          "--card-caption-hover-color": contrastingColor(
            overlay
              ? (gridStyle.captionOverlayColor ?? cardBackground)
              : cardBackground,
            gridStyle.cellTextColor ?? "#eef1f3",
            3,
          ),
          backgroundColor: "var(--card-background)",
        } as React.CSSProperties
      }
      data-index={index}
      aria-busy={importing || undefined}
      data-cell-id={cell.id}
      data-drop-placeholder={dropPlaceholder ? "" : undefined}
      data-image-hovered={imageHovered && !moving ? "" : undefined}
      data-drag-affected={dragAffected ? "" : undefined}
      data-drag-source={dragSource ? "" : undefined}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect =
          event.dataTransfer.effectAllowed === "move" ||
          event.dataTransfer.types.includes("application/x-gridroom-cell")
            ? "move"
            : "copy";
        event.currentTarget.classList.toggle("drag-over", !dragSource);
        onMoveOver?.();
      }}
      onDragLeave={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          event.currentTarget.classList.remove("drag-over");
          onMoveLeave?.();
        }
      }}
      onDrop={(event) => {
        const image = event.currentTarget.querySelector("[data-card-image]");
        setImageHovered(
          Boolean(
            image?.contains(
              document.elementFromPoint(event.clientX, event.clientY),
            ),
          ),
        );
        onDrop(event);
      }}
    >
      {({ open, close }) => (
        <>
          <div
            data-card-content
            className="absolute inset-0 overflow-hidden rounded-[inherit] bg-(--card-background)"
            style={{
              opacity: dragAffected ? 0.35 : 1,
              backgroundColor: dropPlaceholder
                ? "color-mix(in srgb, var(--card-frame-color) var(--card-hover-strength), var(--card-background))"
                : undefined,
            }}
          >
            <div
              data-card-image
              className="group/image absolute inset-x-0 @container"
              style={
                {
                  top: `${(geometry.imageTop / geometry.height) * 100}%`,
                  height: `${(geometry.imageHeight / geometry.height) * 100}%`,
                  "--cell-tool-space": `calc(${(toolSpace / 600) * 100}cqw - 3cqw)`,
                } as React.CSSProperties
              }
              onPointerEnter={(event) => {
                if (event.pointerType === "mouse" && !moving && !previewOnly)
                  setImageHovered(true);
                if (
                  event.pointerType === "mouse" &&
                  asset &&
                  !moving &&
                  !previewOnly &&
                  window.matchMedia("(hover: hover) and (pointer: fine)")
                    .matches &&
                  !open
                )
                  setHoverTools(true);
              }}
              onPointerLeave={(event) => {
                if (event.pointerType === "mouse") {
                  setImageHovered(false);
                  setHoverTools(false);
                  close(event.currentTarget);
                }
              }}
            >
              {asset ? (
                <PopoverButton
                  ref={trigger}
                  className={`${previewOnly ? "drag-preview-image" : library ? "library-image-button" : "cell-image-button"} peer/image overflow-hidden outline-none! ${library?.onSelect ? "cursor-pointer!" : "cursor-move!"}`}
                  data-library-thumbnail={library ? "" : undefined}
                  style={{
                    height: "100%",
                    aspectRatio: geometry.aspectRatio,
                    touchAction: coarsePointer
                      ? library?.onSelect
                        ? "auto"
                        : "manipulation"
                      : undefined,
                  }}
                  aria-label={
                    library
                      ? library.onSelect && !(coarsePointer && asset.provenance)
                        ? t("cell.actions.useImage", { value1: asset.title })
                        : t("cell.actions.imageOptions", { value1: cell.title })
                      : t("cell.actions.options", {
                          value1: index + 1,
                          value2: cell.title ? `: ${cell.title}` : "",
                        })
                  }
                  draggable={
                    !previewOnly &&
                    Boolean(asset) &&
                    !library?.disabled &&
                    !library?.onSelect
                  }
                  onClickCapture={(event) => {
                    if (event.detail > 0 && touchTapped.current) {
                      event.preventDefault();
                      event.stopPropagation();
                      touchTapped.current = false;
                      return;
                    }
                    if (touchDragged.current) {
                      event.preventDefault();
                      event.stopPropagation();
                      touchDragged.current = false;
                      return;
                    }
                    if (
                      library?.onSelect &&
                      !previewOnly &&
                      !(coarsePointer && asset.provenance)
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                      setHoverTools(false);
                      close(event.currentTarget);
                      if (!library.disabled) library.onSelect();
                      return;
                    }
                  }}
                  onPointerDownCapture={(event) => {
                    event.currentTarget.draggable =
                      event.pointerType !== "touch" &&
                      !previewOnly &&
                      !library?.disabled &&
                      !library?.onSelect;
                    if (event.pointerType === "touch") {
                      if (
                        library?.onSelect &&
                        !previewOnly &&
                        !(coarsePointer && asset?.provenance)
                      )
                        event.preventDefault();
                      touchDragged.current = false;
                      touchTapped.current = false;
                      touchStart.current = {
                        x: event.clientX,
                        y: event.clientY,
                      };
                    }
                  }}
                  onPointerMove={(event) => {
                    if (
                      event.pointerType === "touch" &&
                      touchStart.current &&
                      Math.hypot(
                        event.clientX - touchStart.current.x,
                        event.clientY - touchStart.current.y,
                      ) >= 8
                    )
                      touchStart.current = null;
                  }}
                  onPointerCancel={() => {
                    touchStart.current = null;
                  }}
                  onPointerUp={(event) => {
                    if (event.pointerType !== "touch" || !touchStart.current)
                      return;
                    touchStart.current = null;
                    touchTapped.current = true;
                    touchOpenedAt.current = Date.now();
                    if (
                      library?.onSelect &&
                      !previewOnly &&
                      !(coarsePointer && asset?.provenance)
                    ) {
                      event.preventDefault();
                      setHoverTools(false);
                      if (!library.disabled) library.onSelect();
                      return;
                    }
                    event.currentTarget.click();
                  }}
                  onMouseDownCapture={(event) => event.stopPropagation()}
                  onDragStart={(event) => {
                    if (!asset || previewOnly || library?.onSelect) return;
                    setImageHovered(false);
                    setHoverTools(false);
                    close();
                    if (library && asset) {
                      event.dataTransfer.setData(
                        "application/x-gridroom-asset",
                        asset.id,
                      );
                      event.dataTransfer.effectAllowed = "copy";
                    } else {
                      event.dataTransfer.setData(
                        "application/x-gridroom-cell",
                        JSON.stringify({ boardId: gridId, cellId: cell.id }),
                      );
                      event.dataTransfer.effectAllowed = "move";
                    }
                    const bounds = (
                      card.current ?? event.currentTarget
                    ).getBoundingClientRect();
                    const nativePreview = document.createElement("canvas");
                    nativePreview.width = nativePreview.height = 1;
                    nativePreview.style.position = "fixed";
                    nativePreview.style.left = "-10000px";
                    nativePreview.style.pointerEvents = "none";
                    nativePreview.setAttribute("aria-hidden", "true");
                    document.body.append(nativePreview);
                    dragPreview.current?.remove();
                    dragPreview.current = nativePreview;
                    event.dataTransfer.setDragImage(nativePreview, 0, 0);
                    requestAnimationFrame(() => {
                      nativePreview.remove();
                      if (dragPreview.current === nativePreview)
                        dragPreview.current = null;
                    });
                    onMoveStart?.(
                      library
                        ? (library.source ?? {
                            kind: "asset",
                            assetId: asset.id,
                          })
                        : { kind: "cell", gridId, cellId: cell.id },
                      {
                        cell,
                        asset,
                        width: bounds.width,
                        height: bounds.height,
                        offsetX: event.clientX - bounds.left,
                        offsetY: event.clientY - bounds.top,
                        x: event.clientX,
                        y: event.clientY,
                      },
                    );
                  }}
                  onDragEnd={() => {
                    dragPreview.current?.remove();
                    dragPreview.current = null;
                  }}
                >
                  <img
                    className="pointer-events-none rounded-none! border-0!"
                    src={asset.src || undefined}
                    crossOrigin={asset.provenance ? "anonymous" : undefined}
                    onError={() => setFailedImage(asset.src)}
                    referrerPolicy={
                      asset.provenance ? "no-referrer" : undefined
                    }
                    alt={cell.title || asset.title}
                    onLoad={(event) => {
                      setFailedImage(null);
                      setLoadedImage(asset.src);
                      setImageSize({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      });
                    }}
                    style={
                      cropRectangle
                        ? {
                            position: "absolute",
                            width: `${(imageSize.width / cropRectangle.width) * 100}%`,
                            height: `${(imageSize.height / cropRectangle.height) * 100}%`,
                            left: `${(-cropRectangle.x / cropRectangle.width) * 100}%`,
                            top: `${(-cropRectangle.y / cropRectangle.height) * 100}%`,
                            objectFit: "cover",
                          }
                        : { objectFit: "cover" }
                    }
                    draggable={false}
                  />
                  {!previewOnly &&
                    loadedImage !== asset.src &&
                    failedImage !== asset.src && (
                      <span
                        role="status"
                        aria-label={t("common.actions.loading")}
                        className="pointer-events-none absolute inset-0 flex items-center justify-center bg-(--card-background)"
                      >
                        <Spinner size="card" />
                      </span>
                    )}
                  {failedImage === asset.src && (
                    <span
                      role="status"
                      className="absolute inset-0 grid place-items-center bg-ui-panel p-2 text-sm text-ui-text"
                    >
                      {t("account.imageUnavailable")}
                    </span>
                  )}
                </PopoverButton>
              ) : (
                <button
                  ref={trigger}
                  type="button"
                  className={`${previewOnly ? "drag-preview-image" : "cell-image-button"} peer/image outline-none!`}
                  style={{ height: "100%", aspectRatio: geometry.aspectRatio }}
                  aria-label={t("cell.actions.addImage", { value1: index + 1 })}
                  aria-describedby={
                    position && !library && !previewOnly
                      ? `cell-position-${cell.id}`
                      : undefined
                  }
                  title={
                    imageHovered
                      ? t("common.actions.addOrDropImages", { count: 1 })
                      : undefined
                  }
                  onClick={() => {
                    if ((canChoose || coarsePointer) && trigger.current)
                      onChoose(trigger.current);
                    else onUpload();
                  }}
                >
                  {position && !library && !previewOnly && (
                    <span
                      id={`cell-position-${cell.id}`}
                      data-cell-position
                      className="pointer-events-none absolute right-[6cqw] bottom-[3cqw] text-right text-[max(8px,9cqw)] leading-none font-normal tabular-nums"
                      style={{
                        color: contrastingColor(cardBackground, "#7e898a"),
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="block whitespace-nowrap"
                      >
                        {t("cell.position", position)}
                      </span>
                      <span className="sr-only">
                        {t("cell.positionLabel", position)}
                      </span>
                    </span>
                  )}
                  <span
                    className="empty-cell absolute inset-x-0 gap-[3cqw]! text-[8.5cqw]! [&_svg]:size-[min(18cqw,90cqh)]!"
                    style={{
                      containerType: "size",
                      top: `${overlay && alignment === "top" ? (geometry.captionHeight / geometry.imageHeight) * 100 : 0}%`,
                      height: `${(toolSpace / geometry.imageHeight) * 100}%`,
                    }}
                  >
                    <ImagePlus aria-hidden="true" />
                    <span
                      className={
                        overlay && alignment === "middle"
                          ? "hidden"
                          : "hidden @min-[64px]:block"
                      }
                    >
                      {t("common.actions.addImages", { count: 1 })}
                    </span>
                    <span
                      aria-hidden="true"
                      className={
                        overlay && alignment === "middle"
                          ? "hidden"
                          : "hidden text-[7cqw] @min-[120px]:block"
                      }
                    >
                      {t("common.actions.dropHere")}
                    </span>
                  </span>
                </button>
              )}
              {asset && (
                <PopoverPanel
                  static={
                    hoverTools ||
                    Boolean(coarsePointer && library?.onSelect && onCrop)
                  }
                  role="group"
                  aria-label={t("cell.actions.tools")}
                  className="pointer-events-none absolute inset-0 z-10"
                  onPointerDownCapture={() => {
                    touchOpenedAt.current = 0;
                  }}
                  onClickCapture={(event) => {
                    // The browser's click after the opening tap would land on a tool button.
                    if (Date.now() - touchOpenedAt.current < 500) {
                      event.preventDefault();
                      event.stopPropagation();
                    }
                  }}
                  style={
                    {
                      "--card-tool-inset": "4.5cqw",
                      "--card-tool-top-inset":
                        overlay && alignment === "top"
                          ? "4.5cqw"
                          : "var(--card-tool-inset)",
                      "--card-tool-bottom-inset":
                        overlay && alignment === "bottom"
                          ? "4.5cqw"
                          : "var(--card-tool-inset)",
                      "--cell-tool-space": `calc((${(toolSpace / 600) * 100}cqw - var(--card-tool-top-inset) - var(--card-tool-bottom-inset) - 4.5cqw) / 2)`,
                      top: `${(toolTop / geometry.imageHeight) * 100}%`,
                      bottom: `${(toolBottom / geometry.imageHeight) * 100}%`,
                    } as React.CSSProperties
                  }
                >
                  {coarsePointer && onTouchDrag && !library?.onSelect && (
                    <Button
                      {...bindTouchDrag(close)}
                      presentation="icon"
                      size="fluid"
                      aria-label={t("cell.actions.dragImage")}
                      title={t("cell.actions.dragImage")}
                      className={cardToolButtonStyles({
                        position: "topLeft",
                        size: library ? "fixed" : "proportional",
                        dragHandle: true,
                      })}
                    >
                      <Move aria-hidden="true" />
                    </Button>
                  )}
                  {!library && (
                    <div className="contents">
                      <Button
                        presentation="icon"
                        size="fluid"
                        className={cardToolButtonStyles({
                          position: "bottomLeft",
                        })}
                        aria-label={
                          asset
                            ? t("cell.actions.replaceImage")
                            : t("cell.actions.chooseImage")
                        }
                        title={
                          asset
                            ? t("cell.actions.replaceImage")
                            : t("cell.actions.chooseImage")
                        }
                        onClick={() => {
                          setHoverTools(false);
                          close();
                          if (trigger.current) onChoose(trigger.current);
                        }}
                      >
                        <ImagePlus aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                  {onCrop && (
                    <Button
                      presentation="icon"
                      size="fluid"
                      className={cardToolButtonStyles({
                        position: "bottomRight",
                        size: library ? "fixed" : "proportional",
                      })}
                      aria-label={t("crop.title")}
                      title={t("crop.title")}
                      disabled={library?.disabled}
                      onClick={() => {
                        setHoverTools(false);
                        close();
                        setCropTarget(asset.id);
                      }}
                    >
                      <Crop aria-hidden="true" />
                    </Button>
                  )}
                  {(asset || cell.title) &&
                    (selectsLibraryImage ||
                      library?.source?.kind !== "provider") && (
                      <Button
                        presentation="icon"
                        size="fluid"
                        className={cardToolButtonStyles({
                          position: "topRight",
                          size: library ? "fixed" : "proportional",
                        })}
                        aria-label={primaryActionLabel}
                        disabled={library?.disabled}
                        title={primaryActionLabel}
                        onClick={() => {
                          setHoverTools(false);
                          close();
                          if (selectsLibraryImage) library?.onSelect?.();
                          else if (library) library.onDelete();
                          else onClear();
                        }}
                      >
                        {selectsLibraryImage ? (
                          <Check aria-hidden="true" />
                        ) : (
                          <Trash2 aria-hidden="true" />
                        )}
                      </Button>
                    )}
                </PopoverPanel>
              )}
            </div>
            <textarea
              ref={caption}
              className={`${previewOnly ? "drag-preview-heading" : library ? "library-heading asset-name" : "cell-heading"} ${asset && gridStyle.titlesVisible !== false ? "" : "hidden!"} opacity-0 focus:opacity-100 peer/caption absolute inset-x-0 z-20 hover:z-40 focus:z-40 focus:overflow-y-auto! focus:overscroll-contain scrollbar-none [&::-webkit-scrollbar]:hidden min-h-0! field-sizing-fixed! placeholder:text-current placeholder:opacity-65 hover:placeholder:opacity-85 focus:placeholder:opacity-85 outline-none!`}
              style={captionStyle}
              title={cell.title}
              rows={1}
              maxLength={captionMaxLength}
              value={cell.title}
              placeholder={t("editor.headingPlaceholder")}
              aria-label={
                library
                  ? t("cell.caption.libraryLabel", { value1: asset?.title })
                  : t("cell.caption.label", { value1: index + 1 })
              }
              onPointerDown={(event) => {
                if (open || hoverTools) {
                  setHoverTools(false);
                  close(event.currentTarget);
                }
              }}
              onFocus={(event) => {
                centerTextArea(event.currentTarget);
                setCaptionFocused(true);
                if (open || hoverTools) {
                  setHoverTools(false);
                  close(event.currentTarget);
                }
              }}
              onBlur={() => setCaptionFocused(false)}
              onChange={(event) => onPatch({ title: event.target.value })}
            />
            <div
              aria-hidden="true"
              data-caption-preview
              data-library-caption-preview={library || undefined}
              className={`${asset && gridStyle.titlesVisible !== false ? "" : "hidden!"} ${!cell.title ? "[&>span]:opacity-65 peer-hover/caption:[&>span]:opacity-85" : ""} pointer-events-none absolute inset-x-0 z-20 flex items-center justify-center overflow-hidden text-center peer-focus/caption:hidden`}
              style={{
                ...captionStyle,
                fontSize: "var(--library-caption-font-size)",
                lineHeight: 1.05,
                padding: "var(--library-caption-padding)",
              }}
            >
              <span
                className="mb-[-0.15em] line-clamp-3 whitespace-pre-wrap wrap-anywhere pb-[0.15em]"
                style={{ WebkitLineClamp: "var(--library-caption-lines,3)" }}
              >
                {cell.title || t("editor.headingPlaceholder")}
              </span>
            </div>
          </div>
          <span
            aria-hidden="true"
            data-caption-feedback
            className={`${asset && gridStyle.titlesVisible !== false ? "" : "hidden!"} pointer-events-none absolute z-50 border border-solid border-transparent transition-colors in-[.image-card:has(textarea:hover)]:border-(--card-caption-hover-color) in-[.image-card:has(textarea:focus)]:border-(--card-caption-hover-color)`}
            style={
              {
                "--caption-feedback-inset": "-3px",
                "--caption-feedback-top-inset": "-1px",
                left: "var(--caption-feedback-inset)",
                right: "var(--caption-feedback-inset)",
                top: `calc(${(geometry.captionTop / geometry.height) * 100}% + var(--caption-feedback-top-inset))`,
                height: `max(0px, calc(${(geometry.captionHeight / geometry.height) * 100}% - var(--caption-feedback-inset) - var(--caption-feedback-top-inset)))`,
                borderTopLeftRadius:
                  geometry.captionTop === 0
                    ? "max(0px, calc(var(--card-radius) - var(--caption-feedback-inset)))"
                    : 0,
                borderTopRightRadius:
                  geometry.captionTop === 0
                    ? "max(0px, calc(var(--card-radius) - var(--caption-feedback-inset)))"
                    : 0,
                borderBottomLeftRadius:
                  geometry.captionTop + geometry.captionHeight >=
                  geometry.height - 0.01
                    ? "max(0px, calc(var(--card-radius) - var(--caption-feedback-inset)))"
                    : 0,
                borderBottomRightRadius:
                  geometry.captionTop + geometry.captionHeight >=
                  geometry.height - 0.01
                    ? "max(0px, calc(var(--card-radius) - var(--caption-feedback-inset)))"
                    : 0,
              } as React.CSSProperties
            }
          />
          <TextScrollbar
            field={caption}
            active={captionFocused}
            value={cell.title}
            style={{
              top: `${(geometry.captionTop / geometry.height) * 100}%`,
              height: `${(geometry.captionHeight / geometry.height) * 100}%`,
            }}
          />
          <CardBorder style={gridStyle} />
          <CardFrame dotted={dropPlaceholder} />
          {importing && (
            <span
              role="status"
              aria-label={t("library.search.importing")}
              className="pointer-events-none absolute inset-0 z-60 flex items-center justify-center rounded-[inherit] bg-black/40"
            >
              <Spinner size="card" />
            </span>
          )}
          {asset && cropTarget === asset.id && onCrop && (
            <CropEditor
              asset={asset}
              aspect={geometry.aspectRatio}
              initialCrop={cell.crop}
              returnFocus={trigger}
              onClose={() => setCropTarget(null)}
              onApply={(crop) => onCrop(crop, asset.id)}
            />
          )}
        </>
      )}
    </Popover>
  );
}
