import {
  cellGeometry,
  type Asset,
  type Cell,
  type GridStyle,
  type ImageCrop,
} from "../model";
import { captionMaxLength } from "../config";
import type { CSSProperties, Ref } from "react";
import { Spinner } from "./ui/controls";
import { GridCell, type CardDragSource, type CardDragVisual } from "./GridCell";
import { CardBorder } from "./CardFrame";

export function LibraryImagePlaceholder({
  gridStyle,
  captionRows,
  loading = false,
  className = "",
}: {
  gridStyle: GridStyle;
  captionRows: number;
  loading?: boolean;
  className?: string;
}) {
  const geometry = cellGeometry(gridStyle, 600, captionRows);
  return (
    <div
      data-image-placeholder
      data-loading={loading}
      aria-hidden="true"
      className={`w-(--library-card-width,120px)! h-auto! shrink-0 self-start! ${className}`}
      style={{ aspectRatio: `600 / ${geometry.height}` }}
    >
      <div
        className={`image-card @container relative flex w-full items-center justify-center border-0! ${loading ? "" : "opacity-25"}`}
        style={
          {
            aspectRatio: `600 / ${geometry.height}`,
            "--card-radius": `${gridStyle.cornerRadius ?? 12.5}cqw`,
            borderRadius: `${gridStyle.cornerRadius ?? 12.5}% / ${((gridStyle.cornerRadius ?? 12.5) * 600) / geometry.height}%`,
            backgroundColor: gridStyle.cellBackgroundColor ?? "#111315",
          } as CSSProperties
        }
      >
        {loading && <Spinner size="card" className="text-ui-muted" />}
        <CardBorder style={gridStyle} />
      </div>
    </div>
  );
}

export function LibraryImage({
  asset,
  onDelete,
  disabled,
  cell,
  gridStyle,
  onTitle,
  onCrop,
  captionRows,
  onMoveStart,
  onTouchDrag,
  moving,
  dragAffected,
  onSelect,
  importing,
  source,
  elementRef,
  onImageLoad,
  onImageError,
  className = "",
}: {
  asset: Asset;
  onDelete: () => void;
  disabled: boolean;
  cell?: Cell;
  gridStyle: GridStyle;
  onTitle: (title: string) => void;
  onCrop?: (crop: ImageCrop, assetId: string) => void;
  captionRows: number;
  onMoveStart?: (source: CardDragSource, visual: CardDragVisual) => void;
  onTouchDrag?: (
    source: CardDragSource,
    visual: CardDragVisual,
    finished: boolean,
    cancelled: boolean,
  ) => void;
  moving?: boolean;
  dragAffected?: boolean;
  onSelect?: () => void;
  importing?: boolean;
  source?: CardDragSource;
  elementRef?: Ref<HTMLDivElement>;
  onImageLoad?: (image: HTMLImageElement) => void;
  onImageError?: (image: HTMLImageElement) => void;
  className?: string;
}) {
  return (
    <div
      ref={elementRef}
      data-library-image
      className={`relative w-(--library-card-width,120px)! h-auto! shrink-0 self-start! ${className}`}
      style={{
        aspectRatio: `600 / ${cellGeometry(gridStyle, 600, captionRows).height}`,
      }}
      onLoadCapture={(event) => {
        if (event.target instanceof HTMLImageElement)
          onImageLoad?.(event.target);
      }}
      onErrorCapture={(event) => {
        if (event.target instanceof HTMLImageElement)
          onImageError?.(event.target);
      }}
    >
      <GridCell
        cell={
          cell
            ? {
                ...cell,
                title: asset.title.slice(0, captionMaxLength),
                crop: asset.crop,
              }
            : {
                id: asset.id,
                assetId: asset.id,
                title: asset.title.slice(0, captionMaxLength),
                fit: "cover",
                crop: asset.crop,
              }
        }
        asset={asset}
        index={0}
        gridId="library"
        gridStyle={gridStyle}
        captionRows={captionRows}
        canChoose={false}
        onPatch={(patch) => {
          if (patch.title !== undefined) onTitle(patch.title);
        }}
        onCrop={onCrop}
        onClear={onDelete}
        onChoose={() => {}}
        onUpload={() => {}}
        onDrop={(event) => event.preventDefault()}
        library={{ onDelete, disabled, onSelect, source }}
        importing={importing}
        onMoveStart={onMoveStart}
        onTouchDrag={onTouchDrag}
        moving={moving}
        dragAffected={dragAffected}
        dragSource={dragAffected}
      />
    </div>
  );
}
