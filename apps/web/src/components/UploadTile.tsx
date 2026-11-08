import { t } from "../i18n";
import { ImagePlus } from "lucide-react";
import { Spinner } from "./ui/controls";
import { useState, type CSSProperties, type Ref } from "react";
import { cellGeometry, type GridStyle } from "../model";
import { CardBorder, CardFrame } from "./CardFrame";
import { contrastingColor } from "../canvasTheme";

export function UploadTile({
  progress,
  gridStyle,
  captionRows,
  className = "self-start w-full",
  onClick,
  onDropFiles,
  ref,
}: {
  progress: { completed: number; total: number } | null;
  gridStyle: GridStyle;
  captionRows: number;
  className?: string;
  onClick: () => void;
  onDropFiles: (files: FileList) => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const geometry = cellGeometry(gridStyle, 600, captionRows);
  const cardBackground = contrastingColor(
    gridStyle.background,
    gridStyle.cellBackgroundColor ?? "#111315",
    1.5,
  );
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className={`w-(--library-card-width,120px)! h-auto! shrink-0 self-start! ${className}`}
      style={{ aspectRatio: `600 / ${geometry.height}` }}
    >
      <button
        ref={ref}
        data-upload-tile
        type="button"
        aria-label={t("common.actions.addImages", { count: 2 })}
        disabled={progress !== null}
        title={t("common.actions.addOrDropImages", { count: 2 })}
        className="image-card @container relative block size-full border-0! p-0! text-ui-muted outline-none! [--card-frame-color:transparent] data-image-hovered:[--card-frame-color:var(--card-frame-hover-color)] focus-visible:[--card-frame-color:var(--card-frame-hover-color)] disabled:cursor-default! disabled:opacity-100!"
        style={
          {
            aspectRatio: `600 / ${geometry.height}`,
            "--card-radius": `${gridStyle.cornerRadius ?? 12.5}cqw`,
            "--card-background": cardBackground,
            "--card-frame-hover-color": contrastingColor(
              cardBackground,
              cardBackground,
              3,
            ),
            borderRadius: `${gridStyle.cornerRadius ?? 12.5}% / ${((gridStyle.cornerRadius ?? 12.5) * 600) / geometry.height}%`,
            backgroundColor: cardBackground,
            color: contrastingColor(cardBackground, "#eef1f3"),
          } as CSSProperties
        }
        data-image-hovered={hovered && !progress ? "" : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") setHovered(true);
        }}
        onPointerLeave={() => setHovered(false)}
        onClick={onClick}
        onDragOver={(event) => {
          if (!progress && event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setHovered(true);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setHovered(false);
          if (!progress && event.dataTransfer.files.length)
            onDropFiles(event.dataTransfer.files);
        }}
      >
        <span
          data-card-content
          style={{
            backgroundColor:
              "color-mix(in srgb, var(--card-frame-color) var(--card-hover-strength), var(--card-background))",
          }}
          className="absolute inset-0 flex flex-col items-center justify-center gap-[3cqw] overflow-hidden rounded-[inherit] transition-colors [&_svg]:size-[18cqw]!"
        >
          {progress ? (
            <>
              <Spinner size="fluid" />
              <span
                role="status"
                aria-live="polite"
                className="flex flex-col items-center gap-[3cqw]"
              >
                <span className="text-[8.5cqw]">{t("library.importing")}</span>
                <span className="text-[7cqw]">
                  {progress.completed} / {progress.total}
                </span>
              </span>
            </>
          ) : (
            <>
              <ImagePlus aria-hidden="true" />
              <span data-upload-label className="text-[8.5cqw]">
                {t("common.actions.addImages", { count: 2 })}
              </span>
              <span data-upload-label className="text-[7cqw]">
                {t("common.actions.dropHere")}
              </span>
            </>
          )}
        </span>
        <CardBorder style={gridStyle} />
        <CardFrame dotted />
      </button>
    </div>
  );
}
