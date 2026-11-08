import { sourceRectangle, type ImageCrop } from "../model";
import { loadImage } from "../export";

type Preview = { src: string; width: number; height: number };
type Entry = {
  promise: Promise<Preview>;
  users: number;
  bytes: number;
  src?: string;
};

const previews = new Map<string, Entry>();
const maximumBytes = 24 * 1024 * 1024;
let queue: Promise<unknown> = Promise.resolve();

function trimPreviews() {
  let bytes = [...previews.values()].reduce(
    (total, entry) => total + entry.bytes,
    0,
  );
  for (const [key, entry] of previews) {
    if (bytes <= maximumBytes) break;
    if (entry.users || !entry.src) continue;
    URL.revokeObjectURL(entry.src);
    previews.delete(key);
    bytes -= entry.bytes;
  }
}

export function requestCardImage(
  original: string,
  width: number,
  height: number,
  crop?: ImageCrop,
) {
  const key = JSON.stringify([original, width, height, crop]);
  let entry = previews.get(key);
  if (entry) {
    previews.delete(key);
    previews.set(key, entry);
  } else {
    const pending: Entry = {
      users: 0,
      bytes: 0,
      promise: queue
        .catch(() => undefined)
        .then(async () => {
          if (!pending.users)
            throw new DOMException("Preview no longer needed", "AbortError");
          const response = await fetch(original);
          if (!response.ok) throw new Error("The image could not load.");
          const blob = await response.blob();
          const image = await createImageBitmap(blob).catch(() =>
            loadImage(original),
          );
          try {
            const source = sourceRectangle(
              crop,
              image.width,
              image.height,
              width / height,
            );
            const scale =
              blob.type === "image/svg+xml"
                ? 1
                : Math.min(1, source.width / width, source.height / height);
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            const context = canvas.getContext("2d");
            if (!context)
              throw new Error("The image preview could not be created.");
            context.imageSmoothingQuality = "high";
            context.drawImage(
              image,
              source.x,
              source.y,
              source.width,
              source.height,
              0,
              0,
              canvas.width,
              canvas.height,
            );
            const resized = await new Promise<Blob>((resolve, reject) =>
              canvas.toBlob((result) =>
                result
                  ? resolve(result)
                  : reject(
                      new Error("The image preview could not be created."),
                    ),
              ),
            );
            pending.src = URL.createObjectURL(resized);
            pending.bytes = canvas.width * canvas.height * 4;
            trimPreviews();
            return {
              src: pending.src,
              width: canvas.width,
              height: canvas.height,
            };
          } finally {
            if (image instanceof ImageBitmap) image.close();
          }
        }),
    };
    queue = pending.promise;
    pending.promise.catch(() => previews.delete(key));
    previews.set(key, pending);
    entry = pending;
  }
  entry.users++;
  const current = entry;
  return {
    promise: current.promise,
    release: () => {
      current.users--;
      trimPreviews();
    },
  };
}

export function retainCardImage(src: string) {
  const entry = [...previews.values()].find((preview) => preview.src === src);
  if (!entry) return () => {};
  entry.users++;
  return () => {
    entry.users--;
    trimPreviews();
  };
}
