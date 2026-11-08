import { t } from "./i18n";
import { captionMaxLength, imageUploadAccept } from "./config";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type DragEvent,
} from "react";
import { createPortal } from "react-dom";
import { Toaster, toast } from "sonner";
import { PanelsTopLeft, Download, ImagePlus, RefreshCw } from "lucide-react";
import {
  Button,
  ColorField,
  PercentField,
  RangeField,
  SelectField,
} from "./components/ui/controls";
import { Modal } from "./components/ui/Modal";
import { GridResizeControls } from "./components/GridResizer";
import { GridPreview } from "./components/GridPreview";
import { ResetDialog } from "./components/ResetDialog";
import { centerTextArea, TextScrollbar } from "./components/TextScrollbar";
import {
  GridCell,
  type CardDragSource,
  type CardDragVisual,
} from "./components/GridCell";
import { EditorLayout } from "./components/EditorLayout";
import { FontWeightField, ThemeBuilder } from "./components/PresetsPanel";
import { contrastingColor } from "./canvasTheme";
import {
  LibraryImage,
  LibraryImagePlaceholder,
} from "./components/LibraryImage";
import { UploadTile } from "./components/UploadTile";
import {
  previewCardMinWidth,
  previewCardMaxWidth,
  resolveFontWeight,
  gridLimit,
  makeWorkspace,
  createResetGridCommand,
  createResizeCommand,
  documentReducer,
  publishers,
  cellGeometry,
  headingGeometry,
  removeCreditRequiredImages,
  type Asset,
  type Board,
  type GridPatch,
  type ImageFormat,
  type ExportSettings,
  type ResetSelection,
} from "./model";
import {
  createExport,
  dimensions,
  loadImage,
  sharedCaptionRows,
} from "./export";
import { LocalWorkspaceStore, LocalWorkspaceConflictError } from "./storage";
import { useEditorState } from "./browser/navigation";

const pickerGridClassName =
  "grid grid-cols-[repeat(auto-fill,minmax(min(100%,var(--picker-card-min-width)),1fr))] gap-2.5 *:max-w-(--picker-card-max-width)";

function BoardHeading({
  board,
  rows,
  editing,
  onEdit,
  onChange,
}: {
  board: Board;
  rows: number;
  editing: boolean;
  onEdit: (editing: boolean) => void;
  onChange: (heading: string) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const fieldClass =
    "board-heading-text border-0! rounded-[inherit]! bg-transparent text-inherit [font:inherit] cursor-text! outline-none! hover:bg-[color-mix(in_srgb,var(--heading-feedback-color)_8%,transparent)]! focus:bg-[color-mix(in_srgb,var(--heading-feedback-color)_12%,transparent)]! placeholder:normal-case placeholder:text-(--heading-placeholder-color) placeholder:opacity-100";
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  useLayoutEffect(() => {
    const field = input.current;
    if (!field || !editing) return;
    const center = () => centerTextArea(field);
    const observer = new ResizeObserver(center);
    observer.observe(field);
    center();
    return () => {
      observer.disconnect();
    };
  }, [
    board.heading,
    board.headingFont,
    board.headingFontSize,
    board.headingPadding,
    board.headingFontWeight,
    rows,
    editing,
  ]);
  return (
    <h2
      className="board-export-heading group relative p-0! after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-solid after:border-transparent after:transition-colors hover:after:border-(--heading-feedback-color) focus-within:after:border-(--heading-feedback-color)"
      style={
        {
          borderRadius: `calc(var(--preview-cell-width, calc(100cqw / var(--columns))) * ${(board.cornerRadius ?? 12.5) / 100})`,
          fontWeight: resolveFontWeight(
            board.headingFont,
            board.headingFontWeight,
          ),
          textShadow: board.publisher === "none" ? "none" : undefined,
          "--heading-feedback-color": contrastingColor(
            board.headingBackgroundColor ?? board.background,
            board.headingTextColor ?? "#eef1f3",
            3,
          ),
          "--heading-placeholder-color": contrastingColor(
            board.headingBackgroundColor ?? board.background,
            "#92999c",
          ),
          fontSize: `calc(var(--preview-cell-width, calc(100cqw / var(--columns))) * ${(board.headingFontSize ?? 21) / 100})`,
          height: `calc(var(--preview-cell-width, calc(100cqw / var(--columns))) * ${headingGeometry(board, 1, rows).height})`,
          "--heading-padding": `calc(var(--preview-cell-width, calc(100cqw / var(--columns))) * ${headingGeometry(board, 1).padding})`,
          ...(!board.heading.trim()
            ? {
                background:
                  board.headingBackgroundColor ??
                  publishers[board.publisher].caption,
              }
            : board.headingBackgroundColor
              ? { background: board.headingBackgroundColor }
              : {}),
        } as React.CSSProperties
      }
    >
      {editing ? (
        <textarea
          ref={input}
          className={`${fieldClass} min-h-0! field-sizing-fixed! resize-none! overflow-y-auto! overscroll-contain scrollbar-none [&::-webkit-scrollbar]:hidden`}
          aria-label={t("editor.headingLabel")}
          rows={1}
          maxLength={captionMaxLength}
          value={board.heading}
          placeholder={t("editor.headingPlaceholder")}
          onChange={(event) => onChange(event.target.value)}
          onBlur={() => onEdit(false)}
          onKeyDown={(event) => {
            if (
              !event.nativeEvent.isComposing &&
              ((event.key === "Enter" && !event.shiftKey) ||
                event.key === "Escape")
            ) {
              event.preventDefault();
              onEdit(false);
            }
          }}
          style={{
            font: "inherit",
            color: "inherit",
            background: "transparent",
            border: 0,
            textAlign: "center",
            width: "100%",
            padding: "var(--heading-padding)",
          }}
        />
      ) : (
        <button
          className={`${fieldClass} overflow-hidden p-(--heading-padding)!`}
          aria-label={t("editor.editHeading", {
            value1: board.heading.trim()
              ? board.heading
              : t("editor.headingPlaceholder"),
          })}
          onClick={() => onEdit(true)}
        >
          <span
            data-heading-preview
            data-heading-placeholder={!board.heading.trim() || undefined}
            className={`mb-[-0.15em] line-clamp-3 whitespace-pre-wrap wrap-anywhere pb-[0.15em] ${board.heading.trim() ? "" : "normal-case text-(--heading-placeholder-color)"}`}
          >
            {board.heading.trim()
              ? board.heading
              : t("editor.headingPlaceholder")}
          </span>
        </button>
      )}
      <TextScrollbar
        field={input}
        active={editing}
        value={board.heading}
        kind="heading"
        style={{ top: 0, height: "100%" }}
      />
    </h2>
  );
}

export default function App() {
  const [workspace, dispatchDocument] = useReducer(
    documentReducer,
    undefined,
    makeWorkspace,
  );
  const localStore = useRef<LocalWorkspaceStore | null>(null);
  const savedDocument = useRef(workspace);
  const deliberateReload = useRef(false);
  const reloadButton = useRef<HTMLButtonElement>(null);
  const [conflict, setConflict] = useState(false);
  const [reloadOpen, setReloadOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const displayAssets = workspace.assets;
  const [canSave, setCanSave] = useState(false);
  const activeAssets = workspace.assets.filter(
    (asset) => asset.trashedAt === undefined && !asset.libraryHidden,
  );
  const [headingEditing, setHeadingEditing] = useState(false);
  const [zoom, setZoom] = useEditorState("zoom");
  const [exportOpen, setExportOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetSession, setResetSession] = useState(0);
  const resetButton = useRef<HTMLButtonElement | null>(null);
  const exportButton = useRef<HTMLButtonElement>(null);
  const [imageTarget, setImageTarget] = useState<string | null>(null);
  const closeImagePicker = () => {
    setImageTarget(null);
  };
  const imageReturnFocus = useRef<HTMLButtonElement>(null);
  const uploadTarget = useRef<string | null>(null);
  const addImagesButton = useRef<HTMLButtonElement>(null);
  const [libraryDragOver, setLibraryDragOver] = useState(false);
  const [cardDrag, setCardDrag] = useState<{
    source: CardDragSource;
    visual: CardDragVisual;
    targetId: string | null;
  } | null>(null);
  useEffect(() => {
    const finish = () => {
      setCardDrag(null);
      document
        .querySelectorAll(".image-card.drag-over")
        .forEach((element) => element.classList.remove("drag-over"));
    };
    const move = (event: globalThis.DragEvent) => {
      if (!event.clientX && !event.clientY) return;
      setCardDrag((current) =>
        current
          ? {
              ...current,
              visual: { ...current.visual, x: event.clientX, y: event.clientY },
            }
          : current,
      );
    };
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
    };
    window.addEventListener("dragend", finish);
    window.addEventListener("dragover", move);
    window.addEventListener("drop", finish);
    window.addEventListener("keydown", cancel);
    window.addEventListener("blur", finish);
    return () => {
      window.removeEventListener("dragend", finish);
      window.removeEventListener("dragover", move);
      window.removeEventListener("drop", finish);
      window.removeEventListener("keydown", cancel);
      window.removeEventListener("blur", finish);
    };
  }, []);
  const [importProgress, setImportProgress] = useState<{
    completed: number;
    total: number;
    pending: number;
    loadingCards: number;
  } | null>(null);
  const [saveStatus, setSaveStatus] = useState("Saved locally");
  const { format, resolution, quality } = workspace.exportSettings;
  const patchExport = (patch: Partial<ExportSettings>) =>
    dispatchDocument({ type: "export/patch", patch });
  const [exporting, setExporting] = useState(false);
  const replaceUpload = useRef<HTMLInputElement>(null);
  const board = workspace.grid;
  useLayoutEffect(() => {
    const cleaned = removeCreditRequiredImages(workspace);
    if (cleaned === workspace) return;
    dispatchDocument({ type: "workspace/restore", workspace: cleaned });
    toast.info(t("save.removedAttributed"), {
      id: "unsupported-image-licenses",
    });
  }, [workspace]);
  const [captionRows, setCaptionRows] = useState(1);
  const [previewFrame, setPreviewFrame] = useState<HTMLDivElement | null>(null);
  const pendingResizeScroll = useRef({ rows: false, columns: false });
  useLayoutEffect(() => {
    if (
      !pendingResizeScroll.current.rows &&
      !pendingResizeScroll.current.columns
    )
      return;
    let animationFrame = requestAnimationFrame(() => {
      animationFrame = requestAnimationFrame(() => {
        const scroller = previewFrame?.closest<HTMLElement>(
          "[data-workspace-scroll]",
        );
        const pending = pendingResizeScroll.current;
        pendingResizeScroll.current = { rows: false, columns: false };
        if (scroller) {
          scroller.scrollTo({
            top: pending.rows ? scroller.scrollHeight : scroller.scrollTop,
            left: pending.columns ? scroller.scrollWidth : scroller.scrollLeft,
          });
        }
      });
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [board.id, board.rows, board.columns, previewFrame]);
  useLayoutEffect(() => {
    let active = true;
    const update = () => {
      if (active) setCaptionRows(sharedCaptionRows(board, displayAssets, true));
    };
    update();
    void document.fonts
      .load(
        `${resolveFontWeight(board.cellFont, board.cellFontWeight)} 48px "${board.cellFont}"`,
      )
      .then(update);
    return () => {
      active = false;
    };
  }, [
    board.cells,
    board.cellFont,
    board.cellFontSize,
    board.cellFontWeight,
    displayAssets,
  ]);
  const palette = publishers[board.publisher];
  const size = useMemo(
    () =>
      dimensions(board, resolution, sharedCaptionRows(board, workspace.assets)),
    [board, resolution, workspace.assets],
  );
  useEffect(() => {
    let cancelled = false;
    const store = new LocalWorkspaceStore(() => {
      if (cancelled) return;
      setCanSave(false);
      setConflict(true);
      setSaveStatus("Changed in another tab");
    });
    localStore.current = store;
    const checkForChanges = () => {
      void store.checkForChanges().catch(() => undefined);
    };
    const visible = () => {
      if (document.visibilityState === "visible") checkForChanges();
    };
    window.addEventListener("focus", checkForChanges);
    document.addEventListener("visibilitychange", visible);
    store
      .load()
      .then((restored) => {
        if (cancelled) return;
        savedDocument.current = restored;
        dispatchDocument({ type: "workspace/restore", workspace: restored });
        setCanSave(true);
        setLoaded(true);
      })
      .catch((error) => {
        if (cancelled) return;
        setSaveStatus("Session only");
        toast.error(
          error instanceof Error
            ? `${error.message} Editing and exports remain available for this session.`
            : "Local storage is unavailable. Editing and exports remain available for this session.",
        );
        setLoaded(true);
      });
    return () => {
      cancelled = true;
      window.removeEventListener("focus", checkForChanges);
      document.removeEventListener("visibilitychange", visible);
      store.dispose();
      if (localStore.current === store) localStore.current = null;
    };
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const store = localStore.current;
    let cancelled = false;
    let started = false;
    const save = () => {
      if (
        started ||
        !canSave ||
        !store ||
        (savedDocument.current === workspace && store.hasSavedSnapshot)
      )
        return;
      started = true;
      store
        .save(workspace)
        .then(() => {
          if (cancelled) return;
          savedDocument.current = workspace;
          setSaveStatus("Saved locally");
        })
        .catch((error) => {
          if (cancelled) return;
          if (error instanceof LocalWorkspaceConflictError) return;
          setSaveStatus("Save failed");
          toast.error(
            "Local save failed. Your current grid can still be exported.",
            { id: "local-save-failed" },
          );
        });
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (deliberateReload.current || savedDocument.current === workspace)
        return;
      event.preventDefault();
      event.returnValue = "";
    };
    const visibilityChange = () => {
      if (document.visibilityState === "hidden") save();
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (
      canSave &&
      store &&
      !(savedDocument.current === workspace && store.hasSavedSnapshot)
    ) {
      setSaveStatus("Saving locally");
      if (document.visibilityState === "hidden") save();
      else timer = setTimeout(save, 300);
    }
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", visibilityChange);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", visibilityChange);
    };
  }, [workspace, canSave, loaded]);
  const deleteImages = (assetIds: string[]) => {
    localStore.current?.scheduleImageDeletion(assetIds);
    dispatchDocument({ type: "assets/delete", assetIds });
    requestAnimationFrame(() =>
      addImagesButton.current?.focus({ preventScroll: true }),
    );
  };
  const patchBoard = (patch: GridPatch) =>
    dispatchDocument({ type: "grid/patch", gridId: board.id, patch });
  const placeAsset = (id: string, cellId: string) => {
    dispatchDocument({
      type: "cell/place",
      gridId: board.id,
      cellId,
      assetId: id,
    });
  };
  const resize = (key: "rows" | "columns", input: number) => {
    const value = Math.max(1, Math.min(gridLimit, Math.round(input) || 1));
    if (value === board[key]) return;
    const rows = key === "rows" ? value : board.rows;
    const columns = key === "columns" ? value : board.columns;
    pendingResizeScroll.current[key] = true;
    dispatchDocument(createResizeCommand(board.id, rows, columns));
  };
  const importFiles = async (
    files: FileList | null,
    targetCellId: string | null = null,
  ) => {
    const store = localStore.current;
    if (!store) return;
    const batch = Array.from(files ?? []);
    if (!batch.length) return;
    const chooseImportedImage = batch.length > 1 && targetCellId !== null;
    if (chooseImportedImage) {
      setImageTarget(targetCellId);
    }
    setImportProgress((current) => ({
      completed: current?.completed ?? 0,
      total: (current?.total ?? 0) + batch.length,
      pending: (current?.pending ?? 0) + 1,
      loadingCards: (current?.loadingCards ?? 0) + batch.length,
    }));
    const targetId = board.id;
    let remaining = batch.length;
    const finishFile = () => {
      remaining -= 1;
      setImportProgress((current) =>
        current
          ? {
              ...current,
              completed: current.completed + 1,
              loadingCards: current.loadingCards - 1,
            }
          : null,
      );
    };
    try {
      for (const file of batch) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const gif =
          file.type === "image/gif" ||
          /\.gif$/i.test(file.name) ||
          ["GIF87a", "GIF89a"].includes(await file.slice(0, 6).text());
        if (!file.type.startsWith("image/") || gif) {
          toast.error(
            gif
              ? t("library.gifUnsupported", { value1: file.name })
              : `${file.name} is not an image.`,
          );
          finishFile();
          continue;
        }
        let asset: Asset | null = null;
        try {
          if (localStore.current !== store) return;
          asset = store.createAsset(
            file,
            file.name
              .replace(/\.[^.]+$/, "")
              .replace(/[-_]/g, " ")
              .replace(/\s+/g, " ")
              .trim(),
          );
          await loadImage(asset.src);
          if (localStore.current !== store) return;
          dispatchDocument({
            type: "assets/import",
            gridId: targetId,
            cellId: chooseImportedImage ? null : targetCellId,
            assets: [asset],
          });
        } catch {
          if (asset) store.releaseAsset(asset.id);
          toast.error(
            `Could not load ${file.name}. Try a PNG, JPEG, or WebP image.`,
          );
        } finally {
          finishFile();
        }
      }
    } finally {
      setImportProgress((current) =>
        current && current.pending > 1
          ? {
              ...current,
              pending: current.pending - 1,
              loadingCards: current.loadingCards - remaining,
            }
          : null,
      );
    }
  };
  const touchDrag = (
    source: CardDragSource,
    visual: CardDragVisual,
    finished: boolean,
    cancelled: boolean,
  ) => {
    const targetId =
      document
        .elementFromPoint(visual.x, visual.y)
        ?.closest(".grid-cell")
        ?.getAttribute("data-cell-id") ?? null;
    const validTarget = board.cells.some((cell) => cell.id === targetId);
    if (finished || cancelled) {
      setCardDrag(null);
      if (!cancelled && validTarget && source.kind === "asset") {
        placeAsset(source.assetId, targetId!);
        if (imageTarget) closeImagePicker();
      }
      if (
        !cancelled &&
        validTarget &&
        source.kind === "cell" &&
        source.gridId === board.id &&
        source.cellId !== targetId &&
        board.cells.some((cell) => cell.id === source.cellId)
      ) {
        dispatchDocument({
          type: "cell/swap",
          gridId: board.id,
          sourceCellId: source.cellId,
          targetCellId: targetId!,
        });
      }
      return;
    }
    setCardDrag({
      source,
      visual: source.kind === "asset" ? libraryDragVisual(visual) : visual,
      targetId:
        validTarget && (source.kind !== "cell" || source.cellId !== targetId)
          ? targetId
          : null,
    });
  };
  const drop = (event: DragEvent<HTMLDivElement>, index: number) => {
    event.preventDefault();
    setCardDrag(null);
    event.currentTarget.classList.remove("drag-over");
    const assetId =
      event.dataTransfer.getData("application/x-gridroom-asset") ||
      (cardDrag?.source.kind === "asset" ? cardDrag.source.assetId : "");
    const sourceIndex = event.dataTransfer.getData(
      "application/x-gridroom-cell",
    );
    if (assetId) placeAsset(assetId, board.cells[index].id);
    else if (sourceIndex !== "" || cardDrag?.source.kind === "cell") {
      let dragged: { boardId?: string; cellId?: string } | null =
        cardDrag?.source.kind === "cell"
          ? { boardId: cardDrag.source.gridId, cellId: cardDrag.source.cellId }
          : null;
      try {
        if (sourceIndex !== "") dragged = JSON.parse(sourceIndex);
      } catch {
        return;
      }
      if (dragged?.boardId !== board.id) return;
      const source = board.cells.findIndex(
        (entry) => entry.id === dragged.cellId,
      );
      if (
        Number.isInteger(source) &&
        source >= 0 &&
        source < board.rows * board.columns
      ) {
        dispatchDocument({
          type: "cell/swap",
          gridId: board.id,
          sourceCellId: board.cells[source].id,
          targetCellId: board.cells[index].id,
        });
      }
    } else if (event.dataTransfer.files.length) {
      importFiles(event.dataTransfer.files, board.cells[index].id);
    }
  };
  const exportGrid = async () => {
    if (exporting) return;
    setExporting(true);
    const item = structuredClone(board);
    const extension = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
    }[format];
    try {
      const blob = await createExport(
        item,
        workspace.assets,
        resolution,
        format,
        quality / 100,
        window.matchMedia("(max-width: 767px), (any-pointer: coarse)").matches
          ? 16_000_000
          : 32_000_000,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${
        item.name
          .replace(/[^a-z0-9 -]/gi, "")
          .trim()
          .replace(/\s+/g, "-")
          .toLowerCase() || "board"
      }.${extension}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setExportOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Export failed. Try a smaller resolution.",
      );
    } finally {
      setExporting(false);
    }
  };
  const upload = async (
    event: ChangeEvent<HTMLInputElement>,
    target: string | null = null,
  ) => {
    const input = event.currentTarget;
    await importFiles(input.files, target);
    input.value = "";
  };
  const resetGrid = (selection: ResetSelection) => {
    if (
      !Object.values(selection).some(Boolean) ||
      importProgress !== null ||
      exporting ||
      conflict
    )
      return;
    const command = createResetGridCommand(selection);
    if (selection.images) {
      const retained = new Set(
        documentReducer(workspace, command).assets.map((asset) => asset.id),
      );
      localStore.current?.scheduleImageDeletion(
        workspace.assets
          .filter((asset) => !retained.has(asset.id))
          .map((asset) => asset.id),
      );
    }
    dispatchDocument(command);
    setHeadingEditing(false);
    setImageTarget(null);
    setCardDrag(null);
    setResetOpen(false);
    previewFrame
      ?.closest("[data-workspace-scroll]")
      ?.scrollTo({ top: 0, left: 0 });
  };
  if (!loaded) {
    return (
      <main className="grid min-h-dvh place-items-center" aria-busy="true">
        <p role="status">{t("editor.loading")}</p>
      </main>
    );
  }
  return (
    <>
      <main className="app-layout relative h-dvh! min-h-0! min-w-0 grid-rows-[auto_minmax(0,1fr)]! transition-[grid-template-columns] duration-(--ui-motion-layout,180ms) ease-in-out motion-reduce:transition-none panel-right:grid! panel-right:grid-cols-[minmax(0,1fr)_0px]! panel-right:has-data-sidebar-open:grid-cols-[minmax(0,1fr)_350px]! panel-bottom:flex! panel-bottom:flex-col!">
        <EditorLayout
          canvasControls={
            <RangeField
              id="canvas-zoom"
              label={t("editor.zoom")}
              value={zoom}
              output={`${zoom}%`}
              valueText={`${zoom}%`}
              min={50}
              max={200}
              step={5}
              className="w-40 shrink-0 group-data-compact-zoom/header:w-20"
              onChange={setZoom}
            />
          }
          onResetOpen={(trigger) => {
            resetButton.current = trigger;
            setResetSession((session) => session + 1);
            setResetOpen(true);
          }}
          resetDisabled={conflict || importProgress !== null || exporting}
          status={
            <span
              id="save-status"
              data-save-state={
                saveStatus === "Saved locally" &&
                savedDocument.current === workspace &&
                canSave
                  ? "saved"
                  : saveStatus === "Saving locally"
                    ? "saving"
                    : "blocked"
              }
              hidden
            >
              {saveStatus === "Saved locally"
                ? t("save.saved")
                : saveStatus === "Saving locally"
                  ? t("save.saving")
                  : saveStatus}
            </span>
          }
          actions={
            <>
              <Button
                id="export-grid-header"
                ref={exportButton}
                aria-haspopup="dialog"
                title={t("export.title")}
                aria-label={t("export.title")}
                className="h-11 shrink-0 py-0 group-data-compact-export/header:size-11 group-data-compact-export/header:gap-0 group-data-compact-export/header:p-0 [&_svg]:size-5 [&_svg]:shrink-0"
                disabled={exporting}
                onClick={() => setExportOpen(true)}
              >
                <Download />
                <span className="whitespace-nowrap group-data-compact-export/header:sr-only">
                  {t("export.title")}
                </span>
              </Button>
            </>
          }
        >
          {() => (
            <aside
              className={`asset-panel p-0! panel-right:sticky panel-right:top-0 panel-right:h-dvh panel-right:self-start panel-right:overflow-hidden panel-right:[&_.asset-library]:grid-cols-2! ${libraryDragOver ? "outline-2 -outline-offset-2 outline-ui-success" : ""}`}
              aria-label={t("library.dropZone")}
              aria-busy={importProgress !== null}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes("Files")) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  setLibraryDragOver(true);
                }
              }}
              onDragLeave={(event) => {
                if (
                  !(event.relatedTarget instanceof Node) ||
                  !event.currentTarget.contains(event.relatedTarget)
                )
                  setLibraryDragOver(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setLibraryDragOver(false);
                if (event.dataTransfer.files.length)
                  void importFiles(event.dataTransfer.files);
              }}
            >
              <div
                data-sidebar-header
                className="flex min-h-19 shrink-0 items-center border-0 border-b border-solid border-ui-border px-4 py-4 panel-bottom:hidden"
              >
                <a className="brand" href="./">
                  <span className="brand-mark">
                    <PanelsTopLeft />
                  </span>
                  Gridz
                </a>
              </div>
              <div
                data-sidebar-content
                className="contents panel-right:flex panel-right:min-h-0 panel-right:flex-1 panel-right:flex-col panel-right:overflow-y-auto panel-right:overflow-x-hidden panel-right:*:shrink-0 panel-bottom:block"
              >
                <div
                  id="asset-library"
                  data-overlay-scroll="x"
                  className="asset-library @container/shelf panel-right:overflow-visible! panel-bottom:h-(--shelf-content-height) panel-bottom:grid-flow-col panel-bottom:grid-rows-[minmax(0,1fr)] panel-bottom:auto-cols-max panel-bottom:grid-cols-none! panel-bottom:overflow-x-auto panel-bottom:overflow-y-hidden panel-bottom:-m-3! panel-bottom:p-3!"
                >
                  <UploadTile
                    ref={addImagesButton}
                    squareOnShelf
                    progress={importProgress}
                    gridStyle={board}
                    captionRows={captionRows}
                    className="self-start w-full panel-bottom:h-full panel-bottom:max-h-[100cqw] panel-bottom:w-auto panel-bottom:self-auto"
                    onClick={() => document.getElementById("upload")?.click()}
                    onDropFiles={(files) => {
                      setLibraryDragOver(false);
                      void importFiles(files);
                    }}
                  />
                  {renderLibraryImages()}
                  {renderLoadingCards()}
                </div>
                <input
                  id="upload"
                  type="file"
                  accept={imageUploadAccept}
                  multiple
                  hidden
                  onChange={(event) => upload(event)}
                />
              </div>
            </aside>
          )}
          {() => (
            <section
              className="workspace relative flex h-full min-h-0 flex-1 flex-col overflow-hidden"
              aria-label={t("editor.region")}
            >
              {conflict && (
                <div
                  role="alert"
                  className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-ui-border p-4"
                >
                  <p className="m-0 min-w-0 text-sm">{t("save.conflict")}</p>
                  <Button
                    ref={reloadButton}
                    onClick={() => setReloadOpen(true)}
                  >
                    <RefreshCw aria-hidden="true" />
                    {t("save.reload")}
                  </Button>
                </div>
              )}
              <GridPreview
                board={board}
                assets={displayAssets}
                captionRows={captionRows}
                zoom={zoom / 100}
                onFrame={setPreviewFrame}
                bottomControls={
                  <GridResizeControls
                    dimension="rows"
                    rows={board.rows}
                    columns={board.columns}
                    onResize={resize}
                  />
                }
                sideControls={
                  <GridResizeControls
                    dimension="columns"
                    orientation="vertical"
                    rows={board.rows}
                    columns={board.columns}
                    onResize={resize}
                  />
                }
                heading={(rows) =>
                  board.headingVisible && (
                    <BoardHeading
                      board={board}
                      rows={rows}
                      editing={headingEditing}
                      onEdit={setHeadingEditing}
                      onChange={(heading) => patchBoard({ heading })}
                    />
                  )
                }
              >
                <div
                  id="board-grid"
                  className="board-grid"
                  aria-label={t("editor.gridLabel")}
                  style={
                    {
                      width: "var(--preview-board-width)",
                      "--columns": board.columns,
                      "--board-bg": board.background,
                      "--publisher-color": palette.color,
                      "--publisher-text":
                        board.headingTextColor ?? palette.text,
                      "--caption-color": palette.caption,
                      "--heading-font": `"${board.headingFont}"`,
                      "--cell-font": `"${board.cellFont}"`,
                    } as CSSProperties
                  }
                >
                  {board.cells
                    .slice(0, board.rows * board.columns)
                    .map((item, index) => {
                      const asset = displayAssets.find(
                        (asset) => asset.id === item.assetId,
                      );
                      const isSource =
                        cardDrag?.source.kind === "cell" &&
                        cardDrag.source.gridId === board.id &&
                        cardDrag.source.cellId === item.id;
                      return (
                        <GridCell
                          key={item.id}
                          cell={item}
                          asset={asset}
                          canChoose={activeAssets.length > 0}
                          index={index}
                          gridId={board.id}
                          gridStyle={board}
                          captionRows={captionRows}
                          moving={cardDrag !== null}
                          dragSource={isSource}
                          dragAffected={
                            isSource || cardDrag?.targetId === item.id
                          }
                          onMoveStart={(source, visual) =>
                            setCardDrag({ source, visual, targetId: null })
                          }
                          onTouchDrag={touchDrag}
                          onMoveOver={() =>
                            setCardDrag((current) =>
                              current && current.targetId !== item.id
                                ? { ...current, targetId: item.id }
                                : current,
                            )
                          }
                          onMoveLeave={() =>
                            setCardDrag((current) =>
                              current?.targetId === item.id
                                ? { ...current, targetId: null }
                                : current,
                            )
                          }
                          onCrop={(crop, assetId) =>
                            dispatchDocument({
                              type: "cell/crop",
                              gridId: board.id,
                              cellId: item.id,
                              assetId,
                              crop,
                            })
                          }
                          onPatch={(patch) =>
                            dispatchDocument({
                              type: "cell/patch",
                              gridId: board.id,
                              cellId: item.id,
                              patch,
                            })
                          }
                          onClear={() =>
                            dispatchDocument({
                              type: "cell/clear",
                              gridId: board.id,
                              cellId: item.id,
                            })
                          }
                          onChoose={(trigger) => {
                            imageReturnFocus.current = trigger;
                            setImageTarget(item.id);
                          }}
                          onUpload={() => {
                            uploadTarget.current = item.id;
                            replaceUpload.current?.click();
                          }}
                          onDrop={(event) => drop(event, index)}
                        />
                      );
                    })}
                </div>
              </GridPreview>
            </section>
          )}
          {() => (
            <ThemeBuilder
              board={board}
              disabled={conflict || exporting}
              onChange={(patch) => {
                if (patch.headingVisible !== undefined)
                  setHeadingEditing(false);
                patchBoard(patch);
              }}
            >
              <div className="@container/settings flex min-w-0 flex-col gap-4">
                <ColorField
                  id="background"
                  label={t("settings.fields.background")}
                  value={board.background}
                  onChange={(background) => patchBoard({ background })}
                />
                <div className="grid grid-cols-2 gap-4 @max-[260px]/settings:grid-cols-1">
                  <ColorField
                    id="heading-background-color"
                    label={t("builder.headingBackground")}
                    value={board.headingBackgroundColor ?? board.background}
                    onChange={(headingBackgroundColor) =>
                      patchBoard({ headingBackgroundColor })
                    }
                  />
                  <ColorField
                    id="heading-text-color"
                    label={t("builder.headingText")}
                    value={board.headingTextColor ?? palette.text}
                    onChange={(headingTextColor) =>
                      patchBoard({ headingTextColor })
                    }
                  />
                  <ColorField
                    id="cell-background-color"
                    label={t("builder.cardBackground")}
                    value={board.cellBackgroundColor ?? "#111315"}
                    onChange={(cellBackgroundColor) =>
                      patchBoard({ cellBackgroundColor })
                    }
                  />
                  <ColorField
                    id="cell-text-color"
                    label={t("builder.cardText")}
                    value={board.cellTextColor ?? "#f4f4ef"}
                    onChange={(cellTextColor) => patchBoard({ cellTextColor })}
                  />
                </div>
              </div>
              <fieldset
                className="@container/settings m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
                aria-label={t("settings.canvas")}
              >
                <div className="grid grid-cols-2 gap-4 @max-[260px]/settings:grid-cols-1">
                  <PercentField
                    id="canvas-padding"
                    label={t("settings.fields.padding")}
                    outputId="canvas-padding-value"
                    max={120}
                    value={board.canvasPadding ?? 60}
                    onChange={(canvasPadding) => patchBoard({ canvasPadding })}
                  />
                  <PercentField
                    id="gap"
                    label={t("settings.fields.gap")}
                    outputId="gap-value"
                    max={120}
                    value={board.gap}
                    onChange={(gap) => patchBoard({ gap })}
                  />
                </div>
                <PercentField
                  id="corner-rounding"
                  label={t("settings.fields.rounding")}
                  max={25}
                  value={board.cornerRadius ?? 12.5}
                  onChange={(cornerRadius) => patchBoard({ cornerRadius })}
                />
              </fieldset>
              <fieldset
                className="@container/settings m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
                aria-label={t("settings.heading")}
              >
                {board.headingVisible && (
                  <>
                    <div className="grid grid-cols-2 gap-4 @max-[260px]/settings:grid-cols-1">
                      <FontWeightField
                        id="heading-font-weight"
                        font={board.headingFont}
                        value={board.headingFontWeight}
                        onChange={(headingFontWeight) =>
                          patchBoard({ headingFontWeight })
                        }
                      />
                      <PercentField
                        id="heading-font-size"
                        label={t("settings.fields.fontSize")}
                        min={6}
                        max={36}
                        value={board.headingFontSize ?? 21}
                        onChange={(headingFontSize) =>
                          patchBoard({ headingFontSize })
                        }
                      />
                    </div>
                    <PercentField
                      id="heading-padding"
                      label={t("settings.fields.padding")}
                      max={60}
                      value={board.headingPadding ?? 30}
                      onChange={(headingPadding) =>
                        patchBoard({ headingPadding })
                      }
                    />
                  </>
                )}
              </fieldset>
              <fieldset
                className="@container/settings m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
                aria-label={t("settings.card")}
              >
                {board.titlesVisible !== false && (
                  <>
                    <div className="grid grid-cols-2 gap-4 @max-[260px]/settings:grid-cols-1">
                      <FontWeightField
                        id="cell-font-weight"
                        font={board.cellFont}
                        value={board.cellFontWeight}
                        onChange={(cellFontWeight) =>
                          patchBoard({ cellFontWeight })
                        }
                      />
                      <PercentField
                        id="cell-font-size"
                        label={t("settings.fields.fontSize")}
                        min={6}
                        max={36}
                        value={board.cellFontSize ?? 12}
                        onChange={(cellFontSize) =>
                          patchBoard({ cellFontSize })
                        }
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4 @max-[260px]/settings:grid-cols-1">
                      <ColorField
                        id="caption-overlay"
                        label={t("settings.fields.overlayColor")}
                        value={board.captionOverlayColor ?? "#000000"}
                        onChange={(captionOverlayColor) =>
                          patchBoard({ captionOverlayColor })
                        }
                      />
                      <PercentField
                        id="caption-opacity"
                        label={t("settings.fields.overlayOpacity")}
                        value={board.captionOverlayOpacity ?? 60}
                        onChange={(captionOverlayOpacity) =>
                          patchBoard({ captionOverlayOpacity })
                        }
                      />
                    </div>
                  </>
                )}
              </fieldset>
            </ThemeBuilder>
          )}
        </EditorLayout>
      </main>
      {cardDrag?.visual &&
        createPortal(
          <div
            aria-hidden="true"
            inert
            data-drag-floating
            className="pointer-events-none fixed z-100 opacity-100"
            style={{
              width: cardDrag.visual.width,
              height: cardDrag.visual.height,
              left: cardDrag.visual.x - cardDrag.visual.offsetX,
              top: cardDrag.visual.y - cardDrag.visual.offsetY - 8,
              transform: "rotate(-2deg)",
              transformOrigin: `${cardDrag.visual.offsetX}px ${cardDrag.visual.offsetY}px`,
              boxShadow: "var(--drag-shadow)",
              borderRadius: `${board.cornerRadius ?? 12.5}% / ${((board.cornerRadius ?? 12.5) * cardDrag.visual.width) / cardDrag.visual.height}%`,
            }}
          >
            <GridCell
              cell={cardDrag.visual.cell}
              asset={cardDrag.visual.asset}
              index={0}
              gridId={board.id}
              gridStyle={board}
              captionRows={captionRows}
              previewOnly
              canChoose={false}
              onPatch={() => {}}
              onCrop={() => {}}
              onClear={() => {}}
              onChoose={() => {}}
              onUpload={() => {}}
              onDrop={(event) => event.preventDefault()}
            />
          </div>,
          document.body,
        )}
      <Toaster
        position="top-right"
        expand
        visibleToasts={3}
        closeButton
        richColors
      />
      <input
        ref={replaceUpload}
        id="replace-upload"
        type="file"
        accept={imageUploadAccept}
        multiple
        hidden
        onChange={(event) => upload(event, uploadTarget.current)}
      />
      <ResetDialog
        open={resetOpen}
        session={resetSession}
        workspace={workspace}
        disabled={conflict || importProgress !== null || exporting}
        onConfirm={resetGrid}
        onClose={() => setResetOpen(false)}
        returnFocus={resetButton}
      />
      <Modal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title={t("export.title")}
        returnFocus={exportButton}
      >
        <div className="flex flex-col gap-4">
          <SelectField
            id="format"
            label={t("export.format")}
            value={format}
            options={[
              { value: "image/png", label: "PNG" },
              { value: "image/jpeg", label: "JPEG" },
              { value: "image/webp", label: "WebP" },
            ]}
            onChange={(format) =>
              patchExport({ format: format as ImageFormat })
            }
          />
          <SelectField
            id="resolution"
            label={t("export.resolution")}
            value={String(resolution)}
            options={[150, 300, 600, 1200, 1800].map((size) => ({
              value: String(size),
              label: t("export.imageResolution", { value1: size }),
            }))}
            onChange={(resolution) =>
              patchExport({ resolution: Number(resolution) })
            }
          />
          {format !== "image/png" && (
            <PercentField
              id="quality"
              label={t("export.quality")}
              outputId="quality-value"
              min={50}
              max={100}
              step={1}
              value={quality}
              onChange={(quality) => patchExport({ quality })}
            />
          )}
          <p className="text-sm text-ui-muted">
            {size.width} × {size.height}
            {t("export.pixelUnit")}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => setExportOpen(false)}>
              {t("common.actions.cancel")}
            </Button>
            <Button intent="primary" disabled={exporting} onClick={exportGrid}>
              <Download aria-hidden="true" />
              {exporting ? t("export.progress") : t("export.download")}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal
        open={imageTarget !== null}
        onClose={closeImagePicker}
        title={t("cell.actions.chooseImage")}
        returnFocus={imageReturnFocus}
        size="wide"
      >
        <div
          style={
            {
              "--picker-card-min-width": `${previewCardMinWidth}px`,
              "--picker-card-max-width": `${previewCardMaxWidth}px`,
            } as CSSProperties
          }
        >
          <div role="region" aria-label={t("library.source.imported")}>
            <div className={pickerGridClassName}>
              <UploadTile
                progress={importProgress}
                gridStyle={board}
                captionRows={captionRows}
                onClick={() =>
                  document.getElementById("picker-cell-upload")?.click()
                }
                onDropFiles={(files) => {
                  void importFiles(files, imageTarget);
                  if (files.length === 1) closeImagePicker();
                }}
              />
              {renderLibraryImages(true)}
              {renderLoadingCards()}
            </div>
            <input
              id="picker-cell-upload"
              type="file"
              accept={imageUploadAccept}
              multiple
              hidden
              onChange={(event) => {
                if (!event.currentTarget.files?.length) return;
                const singleImage = event.currentTarget.files.length === 1;
                void upload(event, imageTarget);
                if (singleImage) closeImagePicker();
              }}
            />
          </div>
        </div>
      </Modal>
      <Modal
        open={reloadOpen}
        onClose={() => setReloadOpen(false)}
        title={t("save.reload")}
        returnFocus={reloadButton}
      >
        <p>{t("save.reloadPrompt")}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={() => setReloadOpen(false)}>
            {t("common.actions.cancel")}
          </Button>
          <Button
            intent="primary"
            onClick={() => {
              deliberateReload.current = true;
              window.location.reload();
            }}
          >
            <RefreshCw aria-hidden="true" />
            {t("save.reload")}
          </Button>
        </div>
      </Modal>
    </>
  );

  function libraryDragVisual(visual: CardDragVisual): CardDragVisual {
    const bounds = document
      .querySelector("#board-grid > .grid-cell")
      ?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return visual;
    return {
      ...visual,
      width: bounds.width,
      height: bounds.height,
      offsetX: (visual.offsetX / visual.width) * bounds.width,
      offsetY: (visual.offsetY / visual.height) * bounds.height,
    };
  }

  function renderLibraryImages(selectionOnly = false) {
    return activeAssets.map((asset) => (
      <LibraryImage
        key={asset.id}
        className={selectionOnly ? "" : undefined}
        asset={asset}
        cell={board.cells.find((cell) => cell.assetId === asset.id)}
        gridStyle={board}
        captionRows={captionRows}
        disabled={false}
        onTitle={(title) =>
          dispatchDocument({ type: "asset/title", assetId: asset.id, title })
        }
        onCrop={(crop, assetId) =>
          dispatchDocument({ type: "asset/crop", assetId, crop })
        }
        onDelete={() => deleteImages([asset.id])}
        moving={selectionOnly ? undefined : cardDrag !== null}
        dragAffected={
          !selectionOnly &&
          cardDrag?.source.kind === "asset" &&
          cardDrag.source.assetId === asset.id
        }
        onMoveStart={
          selectionOnly
            ? undefined
            : (source, visual) =>
                setCardDrag({
                  source,
                  visual: libraryDragVisual(visual),
                  targetId: null,
                })
        }
        onTouchDrag={selectionOnly ? undefined : touchDrag}
        onSelect={
          selectionOnly
            ? () => {
                if (imageTarget) placeAsset(asset.id, imageTarget);
                closeImagePicker();
              }
            : undefined
        }
      />
    ));
  }

  function renderLoadingCards() {
    return Array.from(
      { length: importProgress?.loadingCards ?? 0 },
      (_, index) => (
        <LibraryImagePlaceholder
          key={`upload:${index}`}
          gridStyle={board}
          captionRows={captionRows}
          loading
        />
      ),
    );
  }
}
