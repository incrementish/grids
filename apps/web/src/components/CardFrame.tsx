import type { GridStyle } from "../model";

export function CardBorder({ style }: { style: GridStyle }) {
  if (!style.cardBorderVisible || (style.cardBorderWidth ?? 0.5) === 0)
    return null;
  return (
    <span
      aria-hidden="true"
      data-card-border
      className="pointer-events-none absolute inset-0 z-45 rounded-[inherit] border-solid"
      style={{
        borderColor: style.cardBorderColor ?? style.cellTextColor ?? "#eef1f3",
        borderWidth: `${style.cardBorderWidth ?? 0.5}cqw`,
      }}
    />
  );
}

export function CardFrame({ dotted = false }: { dotted?: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-cell-image-frame
      className="pointer-events-none absolute inset-0 z-50 rounded-[inherit] border-0 transition-colors"
      style={{
        outline: dotted ? "none" : "1px solid var(--card-frame-color)",
        outlineOffset: "2px",
        backgroundColor: "transparent",
      }}
    >
      <svg
        data-feedback-dots
        aria-hidden="true"
        className={`absolute -inset-0.75 h-[calc(100%+6px)]! w-[calc(100%+6px)]! overflow-visible ${dotted ? "block" : "hidden"}`}
      >
        <rect
          x="0.5"
          y="0.5"
          fill="none"
          stroke="var(--card-frame-color)"
          strokeWidth="1"
          strokeDasharray="2 6"
          strokeLinecap="round"
          style={{
            width: "calc(100% - 1px)",
            height: "calc(100% - 1px)",
            rx: "calc(var(--card-radius) + 2.5px)",
            ry: "calc(var(--card-radius) + 2.5px)",
          }}
        />
      </svg>
    </span>
  );
}
