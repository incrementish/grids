import {
  cellGeometry,
  gridSpacing,
  headingGeometry,
  captionPadding,
  sourceRectangle,
  publishers,
  resolveFontWeight,
  type Asset,
  type Board,
  type ImageFormat,
} from "./model";
import { captionMaxLength } from "./config";

export function dimensions(
  item: Board,
  size: number,
  captionRows = 1,
  headingRows = 1,
) {
  const spacing = gridSpacing(item, size);
  const gap = Math.round(spacing.gap);
  const padding = Math.round(spacing.padding);
  const headingGap = Math.round(spacing.headingGap);
  const geometry = cellGeometry(
    item,
    size,
    item.cells.some((cell) => cell.title.trim()) ? captionRows : 0,
  );
  const rowHeights = Array.from({ length: item.rows }, (_, row) => {
    const hasCaption = item.cells
      .slice(row * item.columns, (row + 1) * item.columns)
      .some((cell) => cell.title.trim());
    return cellGeometry(item, size, hasCaption ? captionRows : 0).height;
  });
  const titleHeight = geometry.captionHeight;
  const headingHeight =
    item.headingVisible && item.heading?.trim()
      ? Math.round(headingGeometry(item, size, headingRows).height) + headingGap
      : 0;
  return {
    gap,
    padding,
    headingGap,
    titleHeight,
    cellHeight: geometry.height,
    headingHeight,
    width: item.columns * size + (item.columns - 1) * gap + padding * 2,
    rowHeights,
    height:
      headingHeight +
      rowHeights.reduce((total, rowHeight) => total + rowHeight, 0) +
      (item.rows - 1) * gap +
      padding * 2,
  };
}
export async function loadImage(src: string) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = src;
  await image.decode();
  return image;
}
function wrapTitle(
  context: CanvasRenderingContext2D,
  title: string,
  maxWidth: number,
  breakWords = false,
) {
  const lines = [];
  for (const paragraph of title.split("\n")) {
    let line = "";
    for (const word of paragraph.match(/\s*\S+|\s+$/g) ?? []) {
      const candidate = line + word;
      if (line && context.measureText(candidate.trimEnd()).width > maxWidth) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else line = candidate;
      if (breakWords && context.measureText(line.trimEnd()).width > maxWidth) {
        const characters = Array.from(line);
        line = "";
        for (const character of characters) {
          if (line && context.measureText(line + character).width > maxWidth) {
            lines.push(line.trimEnd());
            line = character.trimStart();
          } else line += character;
        }
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
export function layoutCaption(
  context: CanvasRenderingContext2D,
  title: string,
  font: string,
  width: number,
  sizePercent = 12,
  fontWeight = 400,
  maximumHeight = Infinity,
  cellPadding = 36,
) {
  const fontSize = Math.min(
    (width * sizePercent) / 100,
    Math.max(0, maximumHeight / 1.05),
  );
  const maximumLines =
    fontSize > 0
      ? Math.max(1, Math.min(3, Math.floor(maximumHeight / (fontSize * 1.05))))
      : 3;
  return layoutText(
    context,
    title,
    font,
    fontSize,
    width - captionPadding(width, cellPadding).horizontal * 2,
    fontWeight,
    maximumLines,
  );
}
function layoutText(
  context: CanvasRenderingContext2D,
  title: string,
  font: string,
  fontSize: number,
  width: number,
  fontWeight: number,
  maximumLines = 3,
  letterSpacing = "0px",
) {
  context.letterSpacing = letterSpacing;
  context.font = `${fontWeight} ${fontSize}px "${font}"`;
  let lines = wrapTitle(context, title, width, true);
  if (lines.length > maximumLines) {
    lines = lines.slice(0, maximumLines);
    const characters = Array.from(lines[maximumLines - 1].trimEnd());
    while (
      characters.length &&
      context.measureText(`${characters.join("")}\u2026`).width > width
    )
      characters.pop();
    lines[maximumLines - 1] = `${characters.join("").trimEnd()}\u2026`;
  }
  return { fontSize, lines };
}
export function layoutHeading(
  context: CanvasRenderingContext2D,
  item: Board,
  size: number,
  width = item.columns * size +
    (item.columns - 1) * gridSpacing(item, size).gap,
) {
  return layoutText(
    context,
    (item.heading.trim() ? item.heading : "Add heading").toUpperCase(),
    item.headingFont,
    (size * (item.headingFontSize ?? 21)) / 100,
    width - headingGeometry(item, size).padding * 2,
    resolveFontWeight(item.headingFont, item.headingFontWeight),
    3,
    "0.5px",
  );
}
export function sharedCaptionRows(
  item: Board,
  assets: Asset[],
  placeholders = false,
) {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return 1;
  const titles = [
    ...(placeholders ? ["Add heading"] : []),
    ...item.cells.map((cell) => cell.title),
    ...assets
      .filter((asset) => !asset.libraryHidden && asset.trashedAt === undefined)
      .map((asset) => asset.title.slice(0, captionMaxLength)),
  ];
  return Math.max(
    1,
    ...titles.map(
      (title) =>
        layoutCaption(
          context,
          title,
          item.cellFont,
          600,
          item.cellFontSize,
          resolveFontWeight(item.cellFont, item.cellFontWeight),
          Infinity,
          item.cellPadding,
        ).lines.length,
    ),
  );
}
function drawTitle(
  context: CanvasRenderingContext2D,
  title: string,
  font: string,
  maximumSize: number,
  left: number,
  top: number,
  width: number,
  height: number,
  color: string,
  fontWeight = 400,
  padding = { horizontal: 0, vertical: 0 },
  caption = false,
  captionSizePercent = 12,
  alignment: "left" | "center" | "right" = "center",
) {
  context.letterSpacing = "0.5px";
  const { fontSize, lines } = caption
    ? layoutCaption(
        context,
        title,
        font,
        width,
        captionSizePercent,
        fontWeight,
        height - padding.vertical * 2,
        (padding.horizontal * 600) / width,
      )
    : layoutText(
        context,
        title,
        font,
        maximumSize,
        width - padding.horizontal * 2,
        fontWeight,
        3,
        "0.5px",
      );
  context.fillStyle = color;
  context.textAlign = alignment;
  context.textBaseline = "middle";
  const lineHeight = fontSize * 1.05;
  lines.forEach((line, lineIndex) =>
    context.fillText(
      line,
      alignment === "left"
        ? left + padding.horizontal
        : alignment === "right"
          ? left + width - padding.horizontal
          : left + width / 2,
      top + height / 2 + (lineIndex - (lines.length - 1) / 2) * lineHeight,
    ),
  );
}
export async function createExport(
  item: Board,
  assets: Asset[],
  size: number,
  mime: ImageFormat,
  quality = 0.95,
  maximumPixels = 32_000_000,
): Promise<Blob> {
  for (const [font, weight] of [
    [item.headingFont, item.headingFontWeight],
    [item.cellFont, item.cellFontWeight],
  ] as const) {
    const description = `${resolveFontWeight(font, weight)} 48px "${font}"`;
    await document.fonts.load(description);
    if (!document.fonts.check(description))
      throw new Error(`${font} could not load. Please reload and try again.`);
  }
  const captionRows = sharedCaptionRows(item, assets);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not create an image.");
  const headingRows = layoutHeading(context, item, size).lines.length;
  const { gap, padding, headingGap, headingHeight, width, height, rowHeights } =
    dimensions(item, size, captionRows, headingRows);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw new Error("Invalid export dimensions.");
  if (width * height > maximumPixels)
    throw new Error(
      `Export exceeds the ${maximumPixels / 1_000_000} MP limit. Choose a smaller resolution.`,
    );
  canvas.width = width;
  canvas.height = height;
  context.fillStyle = item.background;
  context.fillRect(0, 0, width, height);
  const publisher = publishers[item.publisher];
  if (headingHeight) {
    const bandHeight = headingHeight - headingGap;
    const headingPadding = headingGeometry(item, size).padding;
    context.save();
    context.beginPath();
    context.roundRect(
      padding,
      padding,
      width - padding * 2,
      bandHeight,
      ((item.cornerRadius ?? 12.5) * size) / 100,
    );
    context.clip();
    const headingBackground = item.headingBackgroundColor ?? publisher.color;
    if (headingBackground !== "transparent") {
      context.fillStyle = headingBackground;
      context.fillRect(padding, padding, width - padding * 2, bandHeight);
    }
    drawTitle(
      context,
      item.heading.toUpperCase(),
      item.headingFont,
      (size * (item.headingFontSize ?? 21)) / 100,
      padding + headingPadding,
      padding + headingPadding,
      width - padding * 2 - headingPadding * 2,
      bandHeight - headingPadding * 2,
      item.headingTextColor ?? publisher.text,
      resolveFontWeight(item.headingFont, item.headingFontWeight),
      { horizontal: 0, vertical: 0 },
      false,
      12,
      item.headingTextAlignment,
    );
    context.restore();
  }
  const cells = item.cells.slice(0, item.rows * item.columns);
  const images = await Promise.all(
    cells.map(async (entry) => {
      const asset = assets.find((asset) => asset.id === entry.assetId);
      return asset ? loadImage(asset.src) : null;
    }),
  );
  cells.forEach((entry, index) => {
    const geometry = cellGeometry(
      item,
      size,
      entry.title.trim()
        ? item.captionPlacement === "overlay"
          ? layoutCaption(
              context,
              entry.title,
              item.cellFont,
              size,
              item.cellFontSize,
              resolveFontWeight(item.cellFont, item.cellFontWeight),
              Infinity,
              item.cellPadding,
            ).lines.length
          : captionRows
        : 0,
    );
    const left = padding + (index % item.columns) * (size + gap);
    const top =
      padding +
      headingHeight +
      rowHeights
        .slice(0, Math.floor(index / item.columns))
        .reduce((total, rowHeight) => total + rowHeight + gap, 0);
    const imageTop = top + geometry.imageTop;
    context.save();
    context.beginPath();
    context.roundRect(
      left,
      top,
      size,
      geometry.height,
      ((item.cornerRadius ?? 12.5) * size) / 100,
    );
    context.clip();
    context.fillStyle = item.cellBackgroundColor ?? "#111315";
    context.fillRect(left, top, size, geometry.height);
    const image = images[index];
    if (image) {
      const source = sourceRectangle(
        entry.crop,
        image.width,
        image.height,
        geometry.aspectRatio,
      );
      context.save();
      context.beginPath();
      context.rect(left, imageTop, size, geometry.imageHeight);
      context.clip();
      context.drawImage(
        image,
        source.x,
        source.y,
        source.width,
        source.height,
        left,
        imageTop,
        size,
        geometry.imageHeight,
      );
      context.restore();
    }
    if (item.titlesVisible !== false && entry.title.trim()) {
      const captionTop = top + geometry.captionTop;
      context.save();
      context.fillStyle =
        item.captionPlacement === "overlay"
          ? (item.captionOverlayColor ?? "#000000")
          : (item.cellBackgroundColor ?? publisher.caption);
      if (item.captionPlacement === "overlay")
        context.globalAlpha = (item.captionOverlayOpacity ?? 60) / 100;
      context.fillRect(left, captionTop, size, geometry.captionHeight);
      context.restore();
      drawTitle(
        context,
        entry.title,
        item.cellFont,
        size * 0.11,
        left,
        captionTop,
        size,
        geometry.captionHeight,
        item.cellTextColor ?? "#f4f4ef",
        resolveFontWeight(item.cellFont, item.cellFontWeight),
        captionPadding(size, item.cellPadding),
        true,
        item.cellFontSize,
        item.cellTextAlignment,
      );
    }
    if (item.cardBorderVisible && (item.cardBorderWidth ?? 0.5) > 0) {
      const border = (size * (item.cardBorderWidth ?? 0.5)) / 100;
      context.beginPath();
      context.roundRect(
        left + border / 2,
        top + border / 2,
        size - border,
        geometry.height - border,
        Math.max(0, ((item.cornerRadius ?? 12.5) * size) / 100 - border / 2),
      );
      context.lineWidth = border;
      context.strokeStyle =
        item.cardBorderColor ?? item.cellTextColor ?? "#eef1f3";
      context.stroke();
    }
    context.restore();
  });
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mime, quality),
  );
  if (!blob) throw new Error("Export failed. Try a smaller resolution.");
  if (blob.type !== mime)
    throw new Error(
      "This browser does not support that format. Try PNG or JPEG.",
    );
  return blob;
}
