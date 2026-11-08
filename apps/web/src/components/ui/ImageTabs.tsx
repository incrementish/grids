import type { LucideIcon } from "lucide-react";
import { cva } from "class-variance-authority";
import { useLayoutEffect, useRef, useState } from "react";
import { joinedChoiceStyles, joinedControlStyles } from "./controls";

const tabListStyles = cva(
  "grid [&>button]:w-auto! [&>button]:flex-row! [&>button]:enabled:hover:z-10 [&>button:enabled:hover]:control-hover! [&_svg]:size-5! [&_svg]:shrink-0 [&>button>span]:min-w-0 [&>button>span]:text-center [&>button>span]:text-xs [&>button>span]:leading-4 [&>button>span]:font-normal [&>button>span]:whitespace-nowrap",
  {
    variants: {
      vertical: {
        true: "h-full w-11 grid-cols-1 [&>button]:h-auto!",
        false: "w-full [&>button]:h-11!",
      },
      threeTabs: { true: "", false: "" },
      iconsOnly: {
        true: "[&>button>span]:sr-only",
        false: "[&>button>span]:not-sr-only",
      },
    },
    compoundVariants: [
      { vertical: true, threeTabs: true, className: "grid-rows-3" },
      { vertical: true, threeTabs: false, className: "grid-rows-2" },
      { vertical: false, threeTabs: true, className: "grid-cols-3" },
      { vertical: false, threeTabs: false, className: "grid-cols-2" },
    ],
  },
);

export function ImageTabs({
  id,
  label,
  tabs,
  selectedIndex,
  onChange,
  square = false,
  vertical = false,
}: {
  id: string;
  label: string;
  square?: boolean;
  vertical?: boolean;
  selectedIndex: number;
  onChange: (index: number, trigger: HTMLButtonElement) => void;
  tabs: {
    label: string;
    disabled?: boolean;
    title?: string;
    icon?: LucideIcon;
    iconOnly?: boolean;
    popup?: "dialog";
  }[];
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [iconsOnly, setIconsOnly] = useState(false);
  const canCollapse = !vertical && tabs.every((tab) => tab.icon);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !canCollapse) return;
    // Per-tab chrome beyond the label: padding 16 + border 2 + icon 20 + gap 8.
    const update = () => {
      const spans = list.querySelectorAll<HTMLElement>("[role=tab] > span");
      const widest = Math.max(
        0,
        ...[...spans]
          .filter((_, index) => !tabs[index]?.iconOnly)
          .map((span) => span.scrollWidth),
      );
      const iconTabs = tabs.filter((tab) => tab.iconOnly).length;
      const labelTabs = tabs.length - iconTabs;
      setIconsOnly(
        labelTabs > 0 &&
          widest + 46 > (list.clientWidth - iconTabs * 44) / labelTabs,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(list);
    return () => observer.disconnect();
  }, [canCollapse, tabs]);
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-label={label}
      style={
        !vertical && tabs.some((tab) => tab.iconOnly)
          ? {
              gridTemplateColumns: tabs
                .map((tab) => (tab.iconOnly ? "44px" : "minmax(0, 1fr)"))
                .join(" "),
            }
          : undefined
      }
      className={joinedControlStyles({
        orientation: vertical ? "vertical" : "horizontal",
        shape: square ? "square" : "rounded",
        className: tabListStyles({
          vertical,
          threeTabs: tabs.length === 3,
          iconsOnly: vertical || iconsOnly,
        }),
      })}
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.label}
          type="button"
          role="tab"
          id={`${id}-tab-${index}`}
          aria-controls={`${id}-panel-${index}`}
          aria-haspopup={tab.popup}
          aria-selected={index === selectedIndex}
          data-selected={index === selectedIndex ? "" : undefined}
          disabled={tab.disabled || index === selectedIndex}
          tabIndex={tab.disabled || index === selectedIndex ? -1 : 0}
          onClick={(event) => onChange(index, event.currentTarget)}
          onKeyDown={(event) => {
            const previousKey = vertical ? "ArrowUp" : "ArrowLeft";
            const nextKey = vertical ? "ArrowDown" : "ArrowRight";
            if (![previousKey, nextKey, "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const available = [
              ...event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
                '[role="tab"]:not(:disabled)',
              ),
            ];
            const current = available.indexOf(event.currentTarget);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? available.length - 1
                  : (current +
                      (event.key === nextKey ? 1 : -1) +
                      available.length) %
                    available.length;
            available[next]?.focus();
          }}
          title={tab.title ?? tab.label}
          aria-label={tab.label}
          className={joinedChoiceStyles({ spacing: "regular" })}
        >
          {tab.icon && <tab.icon aria-hidden="true" />}
          <span className={tab.iconOnly ? "sr-only!" : undefined}>
            {tab.label}
          </span>
        </button>
      ))}
    </div>
  );
}
