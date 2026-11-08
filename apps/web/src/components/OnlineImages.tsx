import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Orbit,
  Leaf,
  Palette,
  Landmark,
  History,
  UserRound,
  Layers,
  Coffee,
  Grid2X2,
  Search,
  PawPrint,
  Bird,
  Flower2,
} from "lucide-react";
import { t } from "../i18n";
import { cellGeometry } from "../model";
import {
  type ImageProvider,
  ProviderError,
  providerPreviewUrl,
  downloadProviderImage,
  type ProviderImage,
} from "../providers";
import { Button } from "./ui/controls";
import { LibraryImage, LibraryImagePlaceholder } from "./LibraryImage";
import type { CardDragSource } from "./GridCell";
import { useBrowsingState } from "../browser/navigation";
import {
  imagePageSize,
  providerQueryMaxLength,
  providerImageMaxPixels,
} from "../config";

const topicIcons = {
  space: Orbit,
  nature: Leaf,
  art: Palette,
  places: Landmark,
  history: History,
  paintings: Palette,
  sculpture: Landmark,
  portraits: UserRound,
  prints: Layers,
  ceramics: Coffee,
  animals: PawPrint,
  birds: Bird,
  plants: Flower2,
};

function OnlineImage({
  image,
  asset,
  ...props
}: { image: ProviderImage } & ComponentProps<typeof LibraryImage>) {
  const element = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, density: 1 });
  const [thumbnailSize, setThumbnailSize] = useState<{
    width: number;
    height: number;
  }>();
  const [failedPreview, setFailedPreview] = useState("");
  const [originalPreview, setOriginalPreview] = useState<{
    source: string;
    url: string;
  }>();
  useLayoutEffect(() => {
    const root = element.current;
    if (!root) return;
    const measure = () => {
      const width = root.getBoundingClientRect().width;
      if (width > 0)
        setViewport({ width, density: window.devicePixelRatio || 1 });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    let densityQuery = window.matchMedia(
      `(resolution: ${window.devicePixelRatio}dppx)`,
    );
    const densityChanged = () => {
      densityQuery.removeEventListener("change", densityChanged);
      densityQuery = window.matchMedia(
        `(resolution: ${window.devicePixelRatio}dppx)`,
      );
      densityQuery.addEventListener("change", densityChanged);
      measure();
    };
    densityQuery.addEventListener("change", densityChanged);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      densityQuery.removeEventListener("change", densityChanged);
      window.removeEventListener("resize", measure);
    };
  }, []);
  const selectedSrc = viewport.width
    ? providerPreviewUrl(image, viewport.width, viewport.density, thumbnailSize)
    : "";
  const needsOriginal =
    image.provider === "met" && selectedSrc === image.original.url;
  const originalUrl = image.original.url;
  useEffect(() => {
    if (!needsOriginal) return;
    const controller = new AbortController();
    let url = "";
    void downloadProviderImage(image, controller.signal)
      .then(async ({ blob }) => {
        controller.signal.throwIfAborted();
        url = URL.createObjectURL(blob);
        const decoded = new Image();
        decoded.src = url;
        await decoded.decode();
        controller.signal.throwIfAborted();
        if (
          decoded.naturalWidth * decoded.naturalHeight >
          providerImageMaxPixels
        )
          throw new Error("Image dimensions are too large");
        setOriginalPreview({ source: originalUrl, url });
      })
      .catch(() => {
        if (url) URL.revokeObjectURL(url);
        if (!controller.signal.aborted) setReady(true);
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
      setOriginalPreview(undefined);
    };
  }, [needsOriginal, originalUrl]);
  const src = needsOriginal
    ? originalPreview?.source === originalUrl
      ? originalPreview.url
      : image.thumbnail
    : selectedSrc && selectedSrc === failedPreview
      ? image.thumbnail
      : selectedSrc;
  return (
    <div
      className="relative w-(--library-card-width,120px) self-start"
      style={{
        aspectRatio: `600 / ${cellGeometry(props.gridStyle, 600, props.captionRows).height}`,
      }}
      data-online-image-loading={!ready || undefined}
    >
      <LibraryImage
        {...props}
        className={ready ? "size-full" : "invisible size-full"}
        elementRef={element}
        asset={{ ...asset, src }}
        onImageLoad={(loaded) => {
          setReady(true);
          if (image.provider === "met" && loaded.src === image.thumbnail)
            setThumbnailSize({
              width: loaded.naturalWidth,
              height: loaded.naturalHeight,
            });
        }}
        onImageError={(loaded) => {
          if (
            image.provider === "met" &&
            loaded.src === image.thumbnail &&
            !needsOriginal
          ) {
            setThumbnailSize({ width: 0, height: 0 });
            return;
          }
          if (loaded.src !== image.thumbnail) setFailedPreview(loaded.src);
          else setReady(true);
        }}
      />
      {!ready && (
        <div className="absolute inset-0">
          <LibraryImagePlaceholder
            gridStyle={props.gridStyle}
            captionRows={props.captionRows}
            loading
          />
        </div>
      )}
    </div>
  );
}

export function OnlineImages({
  provider,
  onImport,
  selectionOnly = false,
  gridClassName = "grid grid-cols-[repeat(auto-fill,var(--library-card-width,120px))] gap-2.5 panel-bottom:grid-flow-col panel-bottom:grid-rows-[minmax(0,1fr)] panel-bottom:auto-cols-(--library-card-width,120px) panel-bottom:grid-cols-none",
  searchActions,
  dragSource,
  compactRow = false,
  ...cardProps
}: {
  provider: ImageProvider;
  onImport?: (image: ProviderImage, signal: AbortSignal) => Promise<void>;
  selectionOnly?: boolean;
  gridClassName?: string;
  searchActions?: ReactNode;
  dragSource?: CardDragSource;
  compactRow?: boolean;
} & Pick<
  ComponentProps<typeof LibraryImage>,
  "gridStyle" | "captionRows" | "moving" | "onMoveStart" | "onTouchDrag"
>) {
  const [browsing, setBrowsing] = useBrowsingState(provider, selectionOnly);
  const { query, selectedTopic, request, history } = browsing;
  const pageSize = imagePageSize;
  const [filtering, setFiltering] = useState(false);
  const [images, setImages] = useState<ProviderImage[]>([]);
  const [next, setNext] = useState<number>();
  const [loading, setLoading] = useState(Boolean(request));
  const [error, setError] = useState("");
  const [importing, setImporting] = useState<string | null>(null);
  const importController = useRef<AbortController | null>(null);
  useEffect(() => () => importController.current?.abort(), []);
  const importImage = async (image: ProviderImage) => {
    const controller = new AbortController();
    importController.current = controller;
    setImporting(image.id);
    setError("");
    try {
      await onImport?.(image, controller.signal);
    } catch {
      if (!controller.signal.aborted) setError(t("library.search.failed"));
    } finally {
      if (!controller.signal.aborted) setImporting(null);
    }
  };
  useEffect(() => {
    if (query.trim() === request?.query && selectedTopic === request?.topic) {
      setFiltering(false);
      return;
    }
    const timer = window.setTimeout(() => {
      const filter = query.trim();
      const nextRequest = { query: filter, topic: selectedTopic, offset: 0 };
      setFiltering(false);
      setLoading(true);
      setBrowsing((previous) => ({
        ...previous,
        history: [],
        request: nextRequest,
      }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [provider, query, selectedTopic]);
  useEffect(() => {
    if (!request) {
      setImages([]);
      setNext(undefined);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setImages([]);
    setNext(undefined);
    const receiveImages = (readyImages: ProviderImage[]) => {
      if (controller.signal.aborted) return;
      setImages((current) =>
        readyImages.map((image) => {
          const existing = current.find((item) => item.id === image.id);
          return existing ? { ...image, title: existing.title } : image;
        }),
      );
    };
    provider
      .search(
        request.query,
        controller.signal,
        request.offset,
        request.topic,
        pageSize,
        receiveImages,
      )
      .then((result) => {
        if (controller.signal.aborted) return;
        receiveImages(result.images);
        setNext(result.next);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        setImages([]);
        setError(
          !navigator.onLine
            ? t("library.search.offline")
            : failure instanceof ProviderError
              ? t(`library.search.${failure.kind}`, { value1: provider.name })
              : t("library.search.unavailable", { value1: provider.name }),
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [provider, request, pageSize]);

  const busy = loading || filtering;
  const canGoNext = !busy && next !== undefined && images.length >= pageSize;
  const visibleImages = filtering ? [] : images;
  const message =
    !busy &&
    (error || (request && !images.length ? t("library.search.empty") : ""));

  return (
    <section
      aria-label={t("library.source.online")}
      aria-busy={busy}
      className={`@container min-w-0 ${compactRow ? "max-[901px]:contents" : ""}`}
    >
      <div
        className={`mb-2 grid items-end gap-3 ${searchActions ? "grid-cols-1 @min-[520px]:grid-cols-[minmax(0,1fr)_15rem]" : "grid-cols-1"} ${compactRow ? "max-[901px]:col-start-1 max-[901px]:row-start-2 max-[901px]:mb-0 max-[901px]:items-start max-[901px]:pb-2" : ""}`}
      >
        <div className="relative min-w-0">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4! -translate-y-1/2 text-ui-muted"
          />
          <input
            type="search"
            aria-label={t("library.search.query")}
            placeholder={t("library.search.query")}
            value={query}
            maxLength={providerQueryMaxLength}
            onChange={(event) => {
              const query = event.target.value;
              setBrowsing((previous) => ({ ...previous, query }), "silent");
              setFiltering(true);
              setError("");
            }}
            className="min-h-11 w-full min-w-0 pl-10! focus:outline-none! focus:border-ui-accent"
          />
        </div>
        {searchActions}
      </div>
      <div
        data-overlay-scroll={compactRow ? "x" : "none"}
        className={
          compactRow
            ? "contents max-[901px]:col-start-2 max-[901px]:row-span-2 max-[901px]:row-start-1 max-[901px]:flex max-[901px]:h-28 max-[901px]:min-w-0 max-[901px]:items-stretch max-[901px]:gap-2 max-[901px]:overflow-x-scroll max-[901px]:overflow-y-hidden max-[901px]:scrollbar-safe-row max-[901px]:after:w-2 max-[901px]:after:shrink-0 max-[901px]:after:content-['']"
            : "contents"
        }
      >
        {provider.browse.length > 0 && (
          <div
            role="group"
            aria-label={t("library.browse.title")}
            className={`mb-3 flex flex-wrap gap-1 ${compactRow ? "max-[901px]:mb-0 max-[901px]:w-15 max-[901px]:shrink-0 max-[901px]:self-start" : ""}`}
          >
            {[{ id: null }, ...provider.browse].map((topic) => {
              const Icon = topic.id === null ? Grid2X2 : topicIcons[topic.id];
              return (
                <Button
                  key={topic.id ?? "all"}
                  title={t(`library.browse.${topic.id ?? "all"}`)}
                  aria-pressed={selectedTopic === topic.id}
                  disabled={selectedTopic === topic.id && !error}
                  className={`size-8! p-0! ${compactRow ? "max-[901px]:size-7!" : ""} aria-pressed:bg-ui-selected! aria-pressed:text-ui-accent disabled:opacity-100! [&_svg]:size-4!`}
                  onClick={() => {
                    setFiltering(false);
                    setBrowsing({
                      query,
                      selectedTopic: topic.id,
                      history: [],
                      request: {
                        query: query.trim(),
                        topic: topic.id,
                        offset: 0,
                      },
                    });
                  }}
                >
                  <Icon aria-hidden="true" />
                  <span className="sr-only">
                    {t(`library.browse.${topic.id ?? "all"}`)}
                  </span>
                </Button>
              );
            })}
          </div>
        )}
        {busy && (
          <div role="status" className="sr-only" aria-live="polite">
            {t("library.search.loading")}
          </div>
        )}
        <div
          className={`relative ${compactRow ? "max-[901px]:min-h-0 max-[901px]:shrink-0" : ""}`}
          data-online-card-area
        >
          <div className={gridClassName}>
            {visibleImages.map((image) => (
              <OnlineImage
                key={image.id}
                image={image}
                {...cardProps}
                asset={{
                  id: `provider:${image.provider}:${image.id}`,
                  category: "",
                  title: image.title,
                  src: image.thumbnail,
                  provenance: {
                    provider: image.provider,
                    entityId: image.id,
                    sourcePage: image.sourcePage,
                    originalUrl: image.original.url,
                    creator: image.creator,
                    license: image.license,
                    licenseUrl: image.licenseUrl,
                  },
                }}
                className="w-full"
                disabled={importing !== null}
                importing={importing === image.id}
                onTitle={(title) =>
                  setImages((current) =>
                    current.map((item) =>
                      item.id === image.id ? { ...item, title } : item,
                    ),
                  )
                }
                onDelete={() => {}}
                onSelect={
                  selectionOnly && onImport
                    ? () => {
                        void importImage(image);
                      }
                    : undefined
                }
                source={{ kind: "provider", image }}
                dragAffected={
                  dragSource?.kind === "provider" &&
                  dragSource.image.provider === image.provider &&
                  dragSource.image.id === image.id
                }
              />
            ))}
            {Array.from(
              { length: Math.max(0, pageSize - visibleImages.length) },
              (_, index) => (
                <LibraryImagePlaceholder
                  key={`placeholder:${index}`}
                  gridStyle={cardProps.gridStyle}
                  captionRows={cardProps.captionRows}
                  loading={busy}
                  className={
                    compactRow && !busy && !message
                      ? "max-[901px]:hidden"
                      : "max-[901px]:h-full max-[901px]:w-auto"
                  }
                />
              ),
            )}
          </div>
          {message && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
              <p
                role={error ? "alert" : "status"}
                className="max-w-full rounded-md bg-ui-panel/95 px-3 py-2 text-center text-sm wrap-break-word"
              >
                {message}
              </p>
            </div>
          )}
        </div>
        {request && (
          <div
            className={`mt-3 flex justify-between gap-2 ${compactRow ? "max-[901px]:mt-0 max-[901px]:shrink-0 max-[901px]:flex-col max-[901px]:self-center" : ""}`}
          >
            <Button
              aria-label={t("library.search.previous")}
              title={t("library.search.previous")}
              disabled={busy || !history.length}
              onClick={() => {
                setBrowsing((previous) => ({
                  ...previous,
                  request: {
                    topic: request.topic,
                    query: request.query,
                    offset: history[history.length - 1]!,
                  },
                  history: history.slice(0, -1),
                }));
              }}
            >
              <ArrowLeft aria-hidden="true" />
            </Button>
            <Button
              aria-label={t("library.search.next")}
              title={t("library.search.next")}
              disabled={!canGoNext}
              onClick={() => {
                if (!canGoNext) return;
                setBrowsing((previous) => ({
                  ...previous,
                  history: [...history, request.offset],
                  request: {
                    query: request.query,
                    topic: request.topic,
                    offset: next,
                  },
                }));
              }}
            >
              <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
