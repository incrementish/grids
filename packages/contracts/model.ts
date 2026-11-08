import { z } from "zod";
import { captionMaxLength } from "./config.js";

export const fontOptions = ["Bangers", "Bebas Neue", "Boogaloo", "Manrope"];
export function fontWeightOptions(font: string) {
  return [
    { value: 100, label: "Thin" },
    { value: 200, label: "Extra light" },
    { value: 300, label: "Light" },
    { value: 400, label: "Regular" },
    { value: 500, label: "Medium" },
    { value: 600, label: "Semi bold" },
    { value: 700, label: "Bold" },
    { value: 800, label: "Extra bold" },
    { value: 900, label: "Black" },
  ].filter(({ value }) => font === "Manrope" || value === 400 || value === 700);
}
export function resolveFontWeight(font: string, weight = 500) {
  return font === "Manrope" ? weight : weight >= 600 ? 700 : 400;
}
export const gridLimit = 12;
export type Publisher = "none" | "dc" | "marvel";
export type ImageFormat = "image/png" | "image/jpeg" | "image/webp";
export const providerHosts = {
  commons: {
    source: ["commons.wikimedia.org"],
    image: ["upload.wikimedia.org"],
  },
  met: { source: ["www.metmuseum.org"], image: ["images.metmuseum.org"] },
  smk: { source: ["open.smk.dk"], image: ["iip.smk.dk"] },
  inaturalist: {
    source: ["www.inaturalist.org"],
    image: ["inaturalist-open-data.s3.amazonaws.com"],
  },
  openverse: {
    source: ["www.flickr.com", "flickr.com", "commons.wikimedia.org"],
    image: ["live.staticflickr.com", "upload.wikimedia.org"],
  },
  rijksmuseum: { source: ["id.rijksmuseum.nl"], image: ["iiif.micr.io"] },
  wellcome: {
    source: ["wellcomecollection.org"],
    image: ["iiif.wellcomecollection.org"],
  },
} as const;
export const imageLicenseSchema = z.enum(["CC0", "Public domain"]);
export function isProviderUrl(
  provider: keyof typeof providerHosts,
  kind: "source" | "image",
  value: string,
) {
  try {
    const url = new URL(value);
    const hosts: readonly string[] = providerHosts[provider][kind];
    return (
      url.protocol === "https:" &&
      hosts.includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash
    );
  } catch {
    return false;
  }
}
export const provenanceSchema = z
  .strictObject({
    provider: z.enum([
      "commons",
      "met",
      "smk",
      "inaturalist",
      "openverse",
      "rijksmuseum",
      "wellcome",
    ]),
    entityId: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9._ -]+$/),
    sourcePage: z.url({ protocol: /^https$/ }).max(1000),
    originalUrl: z.url({ protocol: /^https$/ }).max(2000),
    creator: z.string().max(1000),
    title: z.string().trim().min(1).max(1000).optional(),
    // Legacy CC BY references remain readable so they can be removed without losing other content.
    license: imageLicenseSchema.or(
      z.enum(["CC BY 1.0", "CC BY 2.0", "CC BY 2.5", "CC BY 3.0", "CC BY 4.0"]),
    ),
    licenseUrl: z.url({
      protocol: /^https$/,
      hostname: /^(creativecommons\.org|commons\.wikimedia\.org)$/,
    }),
  })
  .refine((value) => {
    try {
      const license = new URL(value.licenseUrl);
      const attributed = value.license.startsWith("CC BY ");
      return (
        isProviderUrl(value.provider, "source", value.sourcePage) &&
        isProviderUrl(value.provider, "image", value.originalUrl) &&
        (!["commons", "met", "inaturalist", "rijksmuseum"].includes(
          value.provider,
        ) ||
          /^\d+$/.test(value.entityId)) &&
        (value.provider !== "wellcome" ||
          /^[a-z0-9]{8}$/.test(value.entityId)) &&
        (value.provider !== "openverse" ||
          z.uuid().safeParse(value.entityId).success) &&
        !license.username &&
        !license.password &&
        !license.port &&
        !license.hash &&
        (!attributed ||
          (Boolean(value.title && value.creator.trim()) &&
            license.hostname === "creativecommons.org" &&
            license.pathname.replace(/\/$/, "") ===
              `/licenses/by/${value.license.slice(6)}` &&
            !license.search))
      );
    } catch {
      return false;
    }
  });
export interface Asset {
  id: string;
  category: string;
  title: string;
  src: string;
  source?: string;
  provenance?: z.infer<typeof provenanceSchema>;
  trashedAt?: number;
  libraryHidden?: boolean;
  crop?: ImageCrop;
}
export function removeCreditRequiredImages(workspace: Workspace): Workspace {
  const removed = new Set(
    workspace.assets
      .filter(
        (asset) =>
          asset.provenance &&
          !imageLicenseSchema.safeParse(asset.provenance.license).success,
      )
      .map((asset) => asset.id),
  );
  if (!removed.size) return workspace;
  const cleanCell = (cell: Cell): Cell =>
    cell.assetId && removed.has(cell.assetId)
      ? { ...cell, assetId: null, title: "", crop: undefined }
      : cell;
  return {
    ...workspace,
    assets: workspace.assets.filter((asset) => !removed.has(asset.id)),
    grid: {
      ...workspace.grid,
      cells: workspace.grid.cells.map(cleanCell),
      overflow: workspace.grid.overflow.map((entry) => ({
        ...entry,
        cell: cleanCell(entry.cell),
      })),
    },
  };
}
export interface Cell {
  id: string;
  assetId: string | null;
  title: string;
  fit: "contain" | "cover";
  crop?: ImageCrop;
}
export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function sourceRectangle(
  crop: ImageCrop | undefined,
  imageWidth: number,
  imageHeight: number,
  aspect: number,
) {
  const area = crop
    ? {
        x: crop.x * imageWidth,
        y: crop.y * imageHeight,
        width: crop.width * imageWidth,
        height: crop.height * imageHeight,
      }
    : { x: 0, y: 0, width: imageWidth, height: imageHeight };
  const width = Math.min(area.width, area.height * aspect);
  const height = width / aspect;
  return {
    x: Math.max(
      0,
      Math.min(imageWidth - width, area.x + (area.width - width) / 2),
    ),
    y: Math.max(
      0,
      Math.min(imageHeight - height, area.y + (area.height - height) / 2),
    ),
    width,
    height,
  };
}
export interface OverflowCell {
  row: number;
  column: number;
  cell: Cell;
}
export interface GridLayout {
  rows: number;
  columns: number;
}
export function headingGeometry(style: GridStyle, width: number, rows = 1) {
  const padding = ((style.headingPadding ?? 30) * width) / 600;
  const contentHeight =
    width *
    Math.max(
      0.28,
      (style.headingFontSize ?? 21) * 0.014,
      ((style.headingFontSize ?? 21) / 100) * 1.05 * rows,
    );
  return { padding, contentHeight, height: contentHeight + padding * 2 };
}
export interface GridStyle {
  colorTheme?:
    | "Snow"
    | "Ink"
    | "Forest"
    | "Ocean"
    | "Rose"
    | "Sun"
    | "Cocoa"
    | "Plum";
  publisher: Publisher;
  headingVisible: boolean;
  headingFont: string;
  cellFont: string;
  headingFontWeight?: number;
  cellFontWeight?: number;
  headingFontSize?: number;
  headingPadding?: number;
  headingTextAlignment?: "left" | "center" | "right";
  cellTextAlignment?: "left" | "center" | "right";
  cellPadding?: number;
  cellFontSize?: number;
  headingTextColor?: string;
  cellTextColor?: string;
  headingBackgroundColor?: string;
  cellBackgroundColor?: string;
  cardBorderVisible?: boolean;
  cardBorderColor?: string;
  cardBorderWidth?: number;
  gap: number;
  canvasPadding?: number;
  canvasBackgroundColor?: string;
  background: string;
  imageAspect?: "portrait" | "landscape" | "square";
  cornerRadius?: number;
  titlesVisible?: boolean;
  captionPlacement?: "above" | "below" | "overlay";
  captionAlignment?: "top" | "middle" | "bottom";
  captionOverlayColor?: string;
  captionOverlayOpacity?: number;
}
export function gridSpacing(style: GridStyle, width: number) {
  return {
    gap: (style.gap * width) / 600,
    headingGap: (style.gap * width) / 600,
    padding: ((style.canvasPadding ?? 60) * width) / 600,
  };
}
export const previewCardMinWidth = 128;
export const previewCardMaxWidth = 200;

export function cellGeometry(style: GridStyle, width: number, captionRows = 1) {
  captionRows = Math.min(3, captionRows);
  const aspectRatio =
    style.imageAspect === "portrait"
      ? 3 / 4
      : style.imageAspect === "landscape"
        ? 4 / 3
        : 1;
  const imageHeight = Math.round(width / aspectRatio);
  const placement = style.captionPlacement ?? "below";
  const maximumOverlayHeight = Math.max(
    0,
    imageHeight - Math.ceil(width * 0.5),
  );
  if (placement === "overlay" && width > 0 && captionRows > 0) {
    const lineHeight = width * ((style.cellFontSize ?? 12) / 100) * 1.05;
    const visibleRows = Math.max(
      1,
      Math.floor(
        (maximumOverlayHeight -
          captionPadding(width, style.cellPadding).vertical * 2) /
          lineHeight,
      ),
    );
    captionRows = Math.min(captionRows, visibleRows);
  }
  const requestedCaptionHeight =
    style.titlesVisible === false || captionRows === 0
      ? 0
      : Math.max(
          Math.round(width * 0.23),
          Math.ceil(
            width *
              (((style.cellFontSize ?? 12) / 100) * 1.05 * captionRows + 0.11),
          ),
        );
  const captionHeight =
    placement === "overlay"
      ? Math.min(requestedCaptionHeight, maximumOverlayHeight)
      : requestedCaptionHeight;
  const overlayHeight = imageHeight;
  const captionTop =
    placement === "above"
      ? 0
      : placement === "below"
        ? imageHeight
        : style.captionAlignment === "top"
          ? 0
          : style.captionAlignment === "middle"
            ? Math.round((overlayHeight - captionHeight) / 2)
            : overlayHeight - captionHeight;
  return {
    aspectRatio,
    imageHeight,
    captionHeight,
    captionTop,
    imageTop:
      placement === "above"
        ? captionHeight
        : placement === "overlay"
          ? Math.round((overlayHeight - imageHeight) / 2)
          : 0,
    height:
      placement === "overlay" ? overlayHeight : imageHeight + captionHeight,
  };
}
export function captionPadding(width: number, padding = 36) {
  return {
    horizontal: width * (padding / 600),
    vertical: width * (padding / 720),
  };
}
export interface GridContent {
  id: string;
  name: string;
  heading: string;
  cells: Cell[];
  overflow: OverflowCell[];
}
export interface Board extends GridLayout, GridStyle, GridContent {}
export interface Workspace {
  version: 1;
  assets: Asset[];
  grid: Board;
  exportSettings: ExportSettings;
}
export interface ExportSettings {
  format: ImageFormat;
  resolution: number;
  quality: number;
}
export interface EditorSettings {
  version: 1;
  layout: GridLayout;
  style: GridStyle;
  exportSettings: ExportSettings;
}
export type GridPatch = Partial<
  GridStyle & Pick<GridContent, "name" | "heading">
>;
export type CellPatch = Partial<Pick<Cell, "title" | "fit">>;
export const colorPalettes = [
  {
    name: "Ink",
    background: "#17191b",
    surface: "#23272b",
    text: "#eef1f3",
    overlay: "#111315",
  },
  {
    name: "Forest",
    background: "#18382b",
    surface: "#244b3a",
    text: "#f0f3df",
    overlay: "#18382b",
  },
  {
    name: "Ocean",
    background: "#123d51",
    surface: "#1c5167",
    text: "#def5f4",
    overlay: "#123d51",
  },
  {
    name: "Plum",
    background: "#46215b",
    surface: "#643278",
    text: "#f6eafa",
    overlay: "#2c1639",
  },
  {
    name: "Rose",
    background: "#613745",
    surface: "#754957",
    text: "#ffe6e9",
    overlay: "#613745",
  },
  {
    name: "Cocoa",
    background: "#4a3328",
    surface: "#684b3a",
    text: "#fff0df",
    overlay: "#322219",
  },
  {
    name: "Sun",
    background: "#f4ca36",
    surface: "#fff0a3",
    text: "#222222",
    overlay: "#fff0a3",
  },
  {
    name: "Snow",
    background: "#ffffff",
    surface: "#d9dfdd",
    text: "#202325",
    overlay: "#ffffff",
  },
] as const;

export function colorPaletteStyle(
  name: string | undefined,
): Partial<GridStyle> | undefined {
  const palette = colorPalettes.find((item) => item.name === name);
  return palette
    ? {
        colorTheme: palette.name,
        background: palette.background,
        headingBackgroundColor: palette.background,
        headingTextColor: palette.text,
        cellBackgroundColor: palette.surface,
        cellTextColor: palette.text,
        cardBorderColor: palette.text,
        captionOverlayColor: palette.overlay,
      }
    : undefined;
}

export type ResetSelection = {
  canvas: boolean;
  theme: boolean;
  defaultTheme: boolean;
  images: boolean;
  placements: boolean;
};
export type DocumentCommand =
  | { type: "asset/title"; assetId: string; title: string }
  | { type: "asset/crop"; assetId: string; crop: ImageCrop | undefined }
  | { type: "workspace/restore"; workspace: Workspace }
  | { type: "assets/trash-unused"; assetIds: string[]; trashedAt: number }
  | { type: "assets/restore"; assetIds: string[] }
  | { type: "assets/purge"; assetIds: string[] }
  | { type: "assets/delete"; assetIds: string[] }
  | { type: "grid/patch"; gridId: string; patch: GridPatch }
  | { type: "export/patch"; patch: Partial<ExportSettings> }
  | { type: "cell/patch"; gridId: string; cellId: string; patch: CellPatch }
  | {
      type: "cell/crop";
      gridId: string;
      cellId: string;
      assetId: string;
      crop: ImageCrop | undefined;
    }
  | { type: "cell/clear"; gridId: string; cellId: string }
  | { type: "cell/place"; gridId: string; cellId: string; assetId: string }
  | {
      type: "cell/swap";
      gridId: string;
      sourceCellId: string;
      targetCellId: string;
    }
  | {
      type: "grid/resize";
      gridId: string;
      rows: number;
      columns: number;
      newCells: Cell[];
    }
  | { type: "grid/reset"; defaults: Workspace }
  | { type: "grid/reset-all"; defaults: Workspace; selection: ResetSelection }
  | {
      type: "assets/import";
      gridId: string;
      cellId: string | null;
      assets: Asset[];
    };
type CellFactory = (row: number, column: number) => Cell;
const clampGridSize = (value: number) =>
  Math.max(1, Math.min(gridLimit, Math.round(Number(value) || 1)));
export const publishers = {
  none: { color: "transparent", caption: "#202325", text: "#d8f36a" },
  dc: { color: "#0085c7", caption: "#123c55", text: "#ffffff" },
  marvel: { color: "#ed1d24", caption: "#4b1a20", text: "#ffffff" },
};
export const makeCell = (asset: Asset | null = null): Cell => ({
  id: crypto.randomUUID(),
  assetId: asset?.id ?? null,
  title: asset?.title.slice(0, captionMaxLength) ?? "",
  fit: "cover",
  ...(asset?.crop ? { crop: asset.crop } : {}),
});
export const makeBoard = (name: string, assets: Asset[] = []): Board => ({
  id: crypto.randomUUID(),
  name,
  colorTheme: "Ink",
  publisher: "none",
  heading: "",
  headingVisible: true,
  headingFont: "Manrope",
  cellFont: "Manrope",
  headingFontWeight: 500,
  cellFontWeight: 500,
  headingFontSize: 21,
  headingPadding: 30,
  cellFontSize: 12,
  cornerRadius: 6.25,
  captionOverlayOpacity: 75,
  imageAspect: "portrait",
  captionPlacement: "overlay",
  captionAlignment: "bottom",
  captionOverlayColor: "#111315",
  rows: 3,
  columns: 3,
  gap: 24,
  canvasPadding: 36,
  background: "#17191b",
  headingBackgroundColor: "#17191b",
  headingTextColor: "#eef1f3",
  cellBackgroundColor: "#23272b",
  cellTextColor: "#eef1f3",
  cells: Array.from({ length: 9 }, (_, index) => makeCell(assets[index])),
  overflow: [],
});
export function resizeBoard(
  board: Board,
  rows: number,
  columns: number,
  createCell: CellFactory = () => makeCell(),
): Board {
  rows = clampGridSize(rows);
  columns = clampGridSize(columns);
  const positions = new Map<string, OverflowCell>();
  board.cells.forEach((cell, index) => {
    const row = Math.floor(index / board.columns);
    const column = index % board.columns;
    positions.set(`${row}:${column}`, { row, column, cell });
  });
  const cells = Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const key = `${row}:${column}`;
    const cell = positions.get(key)?.cell ?? createCell(row, column);
    positions.delete(key);
    return cell;
  });
  return { ...board, rows, columns, cells, overflow: [] };
}
export const makeWorkspace = (): Workspace => ({
  version: 1,
  assets: [],
  grid: makeBoard("Grid"),
  exportSettings: { format: "image/png", resolution: 300, quality: 95 },
});

export function resetWorkspace(
  workspace: Workspace,
  defaults = makeWorkspace(),
): Workspace {
  const configured = applyEditorSettings(
    workspace,
    getEditorSettings(defaults),
    (row, column) => defaults.grid.cells[row * defaults.grid.columns + column],
  );
  return {
    ...configured,
    grid: {
      ...configured.grid,
      name: defaults.grid.name,
      heading: defaults.grid.heading,
    },
  };
}

const layoutSchema = z.strictObject({
  rows: z.number().int().min(1).max(gridLimit),
  columns: z.number().int().min(1).max(gridLimit),
});
const styleSchema = z.strictObject({
  colorTheme: z
    .enum(["Snow", "Ink", "Forest", "Ocean", "Rose", "Sun", "Cocoa", "Plum"])
    .optional(),
  publisher: z.enum(["none", "dc", "marvel"]),
  headingVisible: z.boolean(),
  headingFont: z.enum(["Manrope", "Bangers", "Boogaloo", "Bebas Neue"]),
  cellFont: z.enum(["Manrope", "Bangers", "Boogaloo", "Bebas Neue"]),
  headingFontWeight: z
    .number()
    .int()
    .min(100)
    .max(900)
    .multipleOf(100)
    .optional(),
  cellFontWeight: z.number().int().min(100).max(900).multipleOf(100).optional(),
  headingFontSize: z.number().min(6).max(36).optional(),
  headingPadding: z.number().min(0).max(60).optional(),
  headingTextAlignment: z.enum(["left", "center", "right"]).optional(),
  cellTextAlignment: z.enum(["left", "center", "right"]).optional(),
  cellPadding: z.number().min(0).max(120).optional(),
  cellFontSize: z.number().min(6).max(36).optional(),
  headingTextColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  cellTextColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  headingBackgroundColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  cellBackgroundColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  cardBorderVisible: z.boolean().optional(),
  cardBorderColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  cardBorderWidth: z.number().min(0).max(5).optional(),
  gap: z.number().min(0).max(120),
  canvasPadding: z.number().min(0).max(120).optional(),
  canvasBackgroundColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  background: z.string().regex(/^#[0-9a-f]{6}$/i),
  imageAspect: z.enum(["portrait", "landscape", "square"]).optional(),
  cornerRadius: z.number().min(0).max(25).optional(),
  titlesVisible: z.boolean().optional(),
  captionPlacement: z.enum(["above", "below", "overlay"]).optional(),
  captionAlignment: z.enum(["top", "middle", "bottom"]).optional(),
  captionOverlayColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  captionOverlayOpacity: z.number().min(0).max(100).optional(),
});
const exportSettingsSchema = z.strictObject({
  format: z.enum(["image/png", "image/jpeg", "image/webp"]),
  resolution: z.union([
    z.literal(150),
    z.literal(300),
    z.literal(600),
    z.literal(1200),
    z.literal(1800),
  ]),
  quality: z.number().int().min(50).max(100),
});
export const editorSettingsSchema = z.strictObject({
  version: z.literal(1),
  layout: layoutSchema,
  style: styleSchema,
  exportSettings: exportSettingsSchema,
});

export function getEditorSettings(workspace: Workspace): EditorSettings {
  const { grid, exportSettings } = workspace;
  return editorSettingsSchema.parse({
    version: 1,
    layout: { rows: grid.rows, columns: grid.columns },
    style: {
      ...(grid.colorTheme !== undefined ? { colorTheme: grid.colorTheme } : {}),
      publisher: grid.publisher,
      headingVisible: grid.headingVisible,
      headingFont: grid.headingFont,
      cellFont: grid.cellFont,
      ...(grid.cornerRadius !== undefined
        ? { cornerRadius: grid.cornerRadius }
        : {}),
      ...(grid.headingFontWeight !== undefined
        ? { headingFontWeight: grid.headingFontWeight }
        : {}),
      ...(grid.cellFontWeight !== undefined
        ? { cellFontWeight: grid.cellFontWeight }
        : {}),
      ...(grid.headingFontSize !== undefined
        ? { headingFontSize: grid.headingFontSize }
        : {}),
      ...(grid.headingPadding !== undefined
        ? { headingPadding: grid.headingPadding }
        : {}),
      ...(grid.headingTextAlignment !== undefined
        ? { headingTextAlignment: grid.headingTextAlignment }
        : {}),
      ...(grid.cellTextAlignment !== undefined
        ? { cellTextAlignment: grid.cellTextAlignment }
        : {}),
      ...(grid.cellPadding !== undefined
        ? { cellPadding: grid.cellPadding }
        : {}),
      ...(grid.cellFontSize !== undefined
        ? { cellFontSize: grid.cellFontSize }
        : {}),
      ...(grid.headingTextColor !== undefined
        ? { headingTextColor: grid.headingTextColor }
        : {}),
      ...(grid.cellTextColor !== undefined
        ? { cellTextColor: grid.cellTextColor }
        : {}),
      ...(grid.headingBackgroundColor !== undefined
        ? { headingBackgroundColor: grid.headingBackgroundColor }
        : {}),
      ...(grid.cellBackgroundColor !== undefined
        ? { cellBackgroundColor: grid.cellBackgroundColor }
        : {}),
      ...(grid.cardBorderVisible !== undefined
        ? { cardBorderVisible: grid.cardBorderVisible }
        : {}),
      ...(grid.cardBorderColor !== undefined
        ? { cardBorderColor: grid.cardBorderColor }
        : {}),
      ...(grid.cardBorderWidth !== undefined
        ? { cardBorderWidth: grid.cardBorderWidth }
        : {}),
      gap: grid.gap,
      ...(grid.canvasPadding !== undefined
        ? { canvasPadding: grid.canvasPadding }
        : {}),
      ...(grid.canvasBackgroundColor !== undefined
        ? { canvasBackgroundColor: grid.canvasBackgroundColor }
        : {}),
      background: grid.background,
      ...(grid.imageAspect !== undefined
        ? { imageAspect: grid.imageAspect }
        : {}),
      ...(grid.captionPlacement !== undefined
        ? { captionPlacement: grid.captionPlacement }
        : {}),
      ...(grid.titlesVisible !== undefined
        ? { titlesVisible: grid.titlesVisible }
        : {}),
      ...(grid.captionAlignment !== undefined
        ? { captionAlignment: grid.captionAlignment }
        : {}),
      ...(grid.captionOverlayColor !== undefined
        ? { captionOverlayColor: grid.captionOverlayColor }
        : {}),
      ...(grid.captionOverlayOpacity !== undefined
        ? { captionOverlayOpacity: grid.captionOverlayOpacity }
        : {}),
    },
    exportSettings: {
      format: exportSettings.format,
      resolution: exportSettings.resolution,
      quality: exportSettings.quality,
    },
  });
}

function applyGridStyle(grid: Board, style: GridStyle): Board {
  return {
    ...grid,
    colorTheme: style.colorTheme,
    imageAspect: style.imageAspect,
    cornerRadius: style.cornerRadius,
    titlesVisible: style.titlesVisible,
    captionPlacement: style.captionPlacement,
    captionAlignment: style.captionAlignment,
    captionOverlayColor: style.captionOverlayColor,
    captionOverlayOpacity: style.captionOverlayOpacity,
    headingFontSize: style.headingFontSize,
    headingPadding: style.headingPadding,
    headingTextAlignment: style.headingTextAlignment,
    cellTextAlignment: style.cellTextAlignment,
    cellPadding: style.cellPadding,
    cellFontSize: style.cellFontSize,
    headingFontWeight: style.headingFontWeight,
    cellFontWeight: style.cellFontWeight,
    headingTextColor: style.headingTextColor,
    cellTextColor: style.cellTextColor,
    headingBackgroundColor: style.headingBackgroundColor,
    cellBackgroundColor: style.cellBackgroundColor,
    cardBorderVisible: style.cardBorderVisible,
    cardBorderColor: style.cardBorderColor,
    cardBorderWidth: style.cardBorderWidth,
    canvasPadding: style.canvasPadding,
    canvasBackgroundColor: style.canvasBackgroundColor,
    ...style,
  };
}

export function applyEditorSettings(
  workspace: Workspace,
  input: unknown,
  createCell: CellFactory = () => makeCell(),
): Workspace {
  const settings = editorSettingsSchema.parse(input);
  return {
    ...workspace,
    grid: applyGridStyle(
      resizeBoard(
        workspace.grid,
        settings.layout.rows,
        settings.layout.columns,
        createCell,
      ),
      settings.style,
    ),
    exportSettings: settings.exportSettings,
  };
}

export const cropSchema = z
  .strictObject({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine(
    (crop) =>
      crop.x + crop.width <= 1.000001 && crop.y + crop.height <= 1.000001,
  );
const cellSchema = z.strictObject({
  id: z.uuid(),
  assetId: z.uuid().nullable(),
  title: z.string().max(captionMaxLength),
  fit: z.enum(["contain", "cover"]),
  crop: cropSchema.optional(),
});
const coordinate = z
  .number()
  .int()
  .min(0)
  .max(gridLimit - 1);
export const workspaceSchema = z
  .strictObject({
    version: z.literal(1),
    assets: z.array(
      z.strictObject({
        id: z.uuid(),
        category: z.string(),
        title: z.string(),
        src: z.string().min(1),
        source: z.string().min(1).optional(),
        provenance: provenanceSchema.optional(),
        trashedAt: z.number().int().nonnegative().optional(),
        libraryHidden: z.boolean().optional(),
        crop: cropSchema.optional(),
      }),
    ),
    grid: z.strictObject({
      ...layoutSchema.shape,
      ...styleSchema.shape,
      id: z.uuid(),
      name: z.string().max(70),
      heading: z.string().max(captionMaxLength),
      cells: z.array(cellSchema).max(gridLimit * gridLimit),
      overflow: z
        .array(
          z.strictObject({
            row: coordinate,
            column: coordinate,
            cell: cellSchema,
          }),
        )
        .max(gridLimit * gridLimit),
    }),
    exportSettings: exportSettingsSchema,
  })
  .superRefine(({ assets, grid }, context) => {
    const assetIds = new Set(assets.map((asset) => asset.id));
    const cells = [...grid.cells, ...grid.overflow.map((entry) => entry.cell)];
    const positions = grid.overflow.map(
      (entry) => `${entry.row}:${entry.column}`,
    );
    if (
      assetIds.size !== assets.length ||
      new Set(cells.map((cell) => cell.id)).size !== cells.length ||
      grid.cells.length !== grid.rows * grid.columns ||
      new Set(positions).size !== positions.length ||
      grid.overflow.some(
        (entry) => entry.row < grid.rows && entry.column < grid.columns,
      ) ||
      cells.some(
        (cell) => cell.assetId !== null && !assetIds.has(cell.assetId),
      ) ||
      cells.some((cell) =>
        assets.some(
          (asset) => asset.id === cell.assetId && asset.trashedAt !== undefined,
        ),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Invalid grid cells or media references.",
      });
    }
  });

export function createResizeCommand(
  gridId: string,
  rows: number,
  columns: number,
): DocumentCommand {
  rows = clampGridSize(rows);
  columns = clampGridSize(columns);
  return {
    type: "grid/resize",
    gridId,
    rows,
    columns,
    newCells: Array.from({ length: rows * columns }, () => makeCell()),
  };
}

export const createResetCommand = (): DocumentCommand => ({
  type: "grid/reset",
  defaults: makeWorkspace(),
});

export const createResetGridCommand = (
  selection: ResetSelection = {
    canvas: true,
    theme: true,
    defaultTheme: true,
    images: true,
    placements: true,
  },
): DocumentCommand => {
  const defaults = makeWorkspace();
  return {
    type: "grid/reset-all",
    selection: { ...selection },
    defaults: {
      ...defaults,
      grid: { ...resizeBoard(defaults.grid, 2, 2), overflow: [] },
    },
  };
};

function mergeAssets(existing: Asset[], incoming: Asset[]): Asset[] {
  const ids = new Set(existing.map((asset) => asset.id));
  const additions = incoming.filter((asset) => {
    if (ids.has(asset.id)) return false;
    ids.add(asset.id);
    return true;
  });
  return additions.length ? [...existing, ...additions] : existing;
}

export function referencedAssetIds(workspace: Workspace): Set<string> {
  return new Set(
    [
      ...workspace.grid.cells,
      ...workspace.grid.overflow.map((entry) => entry.cell),
    ].flatMap((cell) => (cell.assetId === null ? [] : [cell.assetId])),
  );
}

export function documentReducer(
  workspace: Workspace,
  command: DocumentCommand,
): Workspace {
  const grid = workspace.grid;
  if (
    "gridId" in command &&
    command.type !== "assets/import" &&
    command.gridId !== grid.id
  )
    return workspace;
  const withGrid = (updated: Board): Workspace => ({
    ...workspace,
    grid: updated,
  });
  const updateCell = (
    cellId: string,
    update: (cell: Cell) => Cell,
  ): Workspace => {
    if (!grid.cells.some((cell) => cell.id === cellId)) return workspace;
    return withGrid({
      ...grid,
      cells: grid.cells.map((cell) =>
        cell.id === cellId ? update(cell) : cell,
      ),
    });
  };
  switch (command.type) {
    case "asset/crop": {
      if (
        !workspace.assets.some(
          (asset) =>
            asset.id === command.assetId &&
            asset.trashedAt === undefined &&
            !asset.libraryHidden,
        ) ||
        (command.crop !== undefined &&
          !cropSchema.safeParse(command.crop).success)
      )
        return workspace;
      return {
        ...workspace,
        assets: workspace.assets.map((asset) =>
          asset.id === command.assetId
            ? { ...asset, crop: command.crop }
            : asset,
        ),
      };
    }
    case "asset/title": {
      if (
        !workspace.assets.some((asset) => asset.id === command.assetId) ||
        typeof command.title !== "string" ||
        command.title.length > captionMaxLength
      )
        return workspace;
      return {
        ...workspace,
        assets: workspace.assets.map((asset) =>
          asset.id === command.assetId
            ? { ...asset, title: command.title }
            : asset,
        ),
      };
    }
    case "assets/trash-unused": {
      const ids = new Set(command.assetIds);
      const referenced = referencedAssetIds(workspace);
      return {
        ...workspace,
        assets: workspace.assets.map((asset) =>
          ids.has(asset.id) &&
          asset.trashedAt === undefined &&
          !referenced.has(asset.id)
            ? { ...asset, trashedAt: command.trashedAt }
            : asset,
        ),
      };
    }
    case "assets/restore": {
      const ids = new Set(command.assetIds);
      return {
        ...workspace,
        assets: workspace.assets.map((asset) =>
          ids.has(asset.id) && asset.trashedAt !== undefined
            ? { ...asset, trashedAt: undefined }
            : asset,
        ),
      };
    }
    case "assets/purge": {
      const ids = new Set(command.assetIds);
      const referenced = referencedAssetIds(workspace);
      return {
        ...workspace,
        assets: workspace.assets.filter(
          (asset) =>
            !ids.has(asset.id) ||
            asset.trashedAt === undefined ||
            referenced.has(asset.id),
        ),
      };
    }
    case "assets/delete": {
      const ids = new Set(command.assetIds);
      if (
        !workspace.assets.some(
          (asset) => ids.has(asset.id) && !asset.libraryHidden,
        )
      )
        return workspace;
      const referenced = referencedAssetIds(workspace);
      return {
        ...workspace,
        assets: workspace.assets
          .filter((asset) => !ids.has(asset.id) || referenced.has(asset.id))
          .map((asset) =>
            ids.has(asset.id) ? { ...asset, libraryHidden: true } : asset,
          ),
      };
    }
    case "workspace/restore":
      return command.workspace;
    case "grid/patch":
      return withGrid({ ...grid, ...command.patch });
    case "export/patch":
      return {
        ...workspace,
        exportSettings: { ...workspace.exportSettings, ...command.patch },
      };
    case "cell/patch":
      return updateCell(command.cellId, (cell) => ({
        ...cell,
        ...command.patch,
      }));
    case "cell/crop": {
      const target = grid.cells.find((cell) => cell.id === command.cellId);
      if (!target || target.assetId !== command.assetId) return workspace;
      if (
        command.crop !== undefined &&
        !cropSchema.safeParse(command.crop).success
      )
        return workspace;
      return updateCell(command.cellId, (cell) => ({
        ...cell,
        fit: "cover",
        crop: command.crop,
      }));
    }
    case "cell/clear":
      return updateCell(command.cellId, (cell) => ({
        ...cell,
        assetId: null,
        title: "",
        fit: "cover",
        crop: undefined,
      }));
    case "cell/place": {
      const asset = workspace.assets.find(
        (asset) =>
          asset.id === command.assetId && asset.trashedAt === undefined,
      );
      return asset
        ? updateCell(command.cellId, (cell) => ({
            ...cell,
            assetId: asset.id,
            title: asset.title.slice(0, captionMaxLength),
            fit: "cover",
            crop: asset.crop,
          }))
        : workspace;
    }
    case "cell/swap": {
      const source = grid.cells.find(
        (cell) => cell.id === command.sourceCellId,
      );
      const target = grid.cells.find(
        (cell) => cell.id === command.targetCellId,
      );
      if (!source || !target || source === target) return workspace;
      return withGrid({
        ...grid,
        cells: grid.cells.map((cell) =>
          cell.id === source.id
            ? { ...target, id: source.id }
            : cell.id === target.id
              ? { ...source, id: target.id }
              : cell,
        ),
      });
    }
    case "grid/resize":
      return withGrid(
        resizeBoard(
          grid,
          command.rows,
          command.columns,
          (row, column) => command.newCells[row * command.columns + column],
        ),
      );
    case "grid/reset":
      return resetWorkspace(workspace, command.defaults);
    case "grid/reset-all": {
      const { canvas, theme, defaultTheme, images, placements } =
        command.selection;
      if (canvas && defaultTheme && images && placements)
        return command.defaults;
      if (!canvas && !theme && !defaultTheme && !images && !placements)
        return workspace;
      const clearCell = (cell: Cell): Cell => ({
        id: cell.id,
        title: "",
        assetId: null,
        fit: "cover",
      });
      let nextGrid =
        theme || defaultTheme
          ? applyGridStyle(grid, {
              ...getEditorSettings(command.defaults).style,
              ...(!defaultTheme
                ? colorPaletteStyle(grid.colorTheme)
                : undefined),
            })
          : grid;
      if (canvas) {
        nextGrid = {
          ...nextGrid,
          id: command.defaults.grid.id,
          name: command.defaults.grid.name,
          heading: "",
          rows: command.defaults.grid.rows,
          columns: command.defaults.grid.columns,
          cells: command.defaults.grid.cells,
          overflow: [],
        };
      } else if (placements) {
        nextGrid = {
          ...nextGrid,
          heading: "",
          cells: nextGrid.cells.map(clearCell),
          overflow: nextGrid.overflow.map((entry) => ({
            ...entry,
            cell: clearCell(entry.cell),
          })),
        };
      }
      const referenced = referencedAssetIds({ ...workspace, grid: nextGrid });
      return {
        ...workspace,
        grid: nextGrid,
        assets: images
          ? workspace.assets
              .filter((asset) => referenced.has(asset.id))
              .map((asset) => ({ ...asset, libraryHidden: true }))
          : workspace.assets,
      };
    }
    case "assets/import": {
      const assets = mergeAssets(workspace.assets, command.assets);
      const destination =
        command.gridId === grid.id && command.cellId !== null
          ? grid.cells.findIndex((cell) => cell.id === command.cellId)
          : -1;
      if (destination < 0)
        return assets === workspace.assets
          ? workspace
          : { ...workspace, assets };
      return {
        ...workspace,
        assets,
        grid: {
          ...grid,
          cells: grid.cells.map((cell, index) => {
            const asset = command.assets[index - destination];
            return asset
              ? {
                  ...cell,
                  assetId: asset.id,
                  title: asset.title.slice(0, captionMaxLength),
                  fit: "cover",
                  crop: asset.crop,
                }
              : cell;
          }),
        },
      };
    }
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}
