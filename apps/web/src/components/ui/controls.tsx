import { t } from "../../i18n";
import { motionPresets, useUiTransition } from "./motion";
import {
  DataInteractive,
  Description,
  Field,
  DisclosureButton,
  DisclosurePanel,
  Listbox,
  ListboxButton,
  ListboxLabel,
  ListboxOption,
  ListboxOptions,
  Label,
  Radio,
  RadioGroup,
  Switch,
} from "@headlessui/react";
import { cva, type VariantProps } from "class-variance-authority";
import clsx from "clsx";
import {
  ChevronDown,
  LoaderCircle,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";
import {
  m,
  useIsPresent,
  type HTMLMotionProps,
  type Transition,
} from "motion/react";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";

const rangeFieldStyles = cva("flex", {
  variants: {
    layout: { stacked: "flex-col gap-0", inline: "items-center gap-3" },
  },
  defaultVariants: { layout: "stacked" },
});

export function RangeField({
  id,
  label,
  output,
  outputId,
  value,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  valueText,
  layout = "stacked",
  className,
  onChange,
}: {
  id: string;
  label: string;
  output: ReactNode;
  outputId?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  valueText?: string;
  layout?: "stacked" | "inline";
  className?: string;
  onChange: (value: number) => void;
}) {
  const result = (
    <output
      id={outputId}
      htmlFor={id}
      className={
        layout === "inline" ? "w-12 shrink-0 text-right" : "whitespace-nowrap"
      }
    >
      {output}
    </output>
  );
  return (
    <Field
      disabled={disabled}
      className={rangeFieldStyles({
        layout,
        className: clsx(
          "@container/range min-w-0",
          layout === "stacked" && "in-data-design-customize:gap-0.5",
          className,
        ),
      })}
    >
      <Label
        htmlFor={id}
        className={
          layout === "inline"
            ? "shrink-0"
            : "field-label px-2 in-data-design-customize:@max-[120px]/range:grid in-data-design-customize:@max-[120px]/range:grid-cols-[minmax(0,1fr)_auto] in-data-design-customize:@max-[120px]/range:items-end! in-data-design-customize:@max-[120px]/range:gap-x-1 in-data-design-customize:@max-[120px]/range:min-h-8 in-data-design-customize:@max-[120px]/range:px-0"
        }
      >
        <span className="min-w-0 wrap-anywhere">{label}</span>
        {layout === "stacked" && <> {result}</>}
      </Label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={valueText}
        style={
          {
            "--range-progress": `${max > min ? ((value - min) / (max - min)) * 100 : 0}%`,
          } as CSSProperties
        }
        className={clsx(
          "ui-range outline-none!",
          layout === "inline" ? "h-11 min-w-0 flex-1" : "h-8",
        )}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      {layout === "inline" && result}
    </Field>
  );
}

const checkboxFieldStyles = cva(
  "min-h-11 min-w-0 rounded-md border border-solid border-ui-border p-3 outline-none! transition-colors motion-reduce:transition-none [--control-hover-base:var(--panel)] hover:control-hover has-[input:focus-visible]:border-ui-accent",
  {
    variants: {
      presentation: {
        inline: "flex cursor-pointer items-center gap-3",
        option: "flex flex-col gap-2 max-[360px]:p-2",
      },
    },
    defaultVariants: { presentation: "inline" },
  },
);

export function CheckboxField({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
  className,
  children,
  "data-reset-option": resetOption,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  children?: ReactNode;
  "data-reset-option"?: string;
}) {
  const input = (
    <input
      id={id}
      type="checkbox"
      className="size-5 shrink-0 accent-ui-accent outline-none!"
      aria-label={label}
      aria-describedby={description ? `${id}-description` : undefined}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
  );
  return (
    <Field
      as={description ? "div" : "label"}
      disabled={disabled}
      data-reset-option={resetOption}
      className={checkboxFieldStyles({
        presentation: description ? "option" : "inline",
        className,
      })}
    >
      {description ? (
        <label className="flex min-w-0 cursor-pointer flex-col gap-2 outline-none!">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            {input}
            <span className="min-w-0 text-sm font-semibold wrap-anywhere">
              {label}
            </span>
          </span>
          <Description
            as="span"
            id={`${id}-description`}
            className="text-sm text-ui-muted wrap-anywhere max-[360px]:text-xs"
          >
            {description}
          </Description>
        </label>
      ) : (
        <>
          {input}
          <span className="font-semibold">{label}</span>
        </>
      )}
      {children}
    </Field>
  );
}

export function PercentField({
  id,
  label,
  value,
  min = 0,
  max = 100,
  step,
  onChange,
  disabled,
  valueText,
  outputId,
  outputValue,
}: {
  id: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  valueText?: string;
  outputId?: string;
  outputValue?: ReactNode;
}) {
  const percent = Math.max(
    0,
    Math.min(100, ((value - min) / (max - min)) * 100),
  );
  return (
    <RangeField
      id={id}
      label={label}
      outputId={outputId}
      output={outputValue ?? `${Number(percent.toFixed(1))}%`}
      step={step === undefined ? 1 : (step / (max - min)) * 100}
      value={percent}
      disabled={disabled}
      valueText={valueText}
      onChange={(next) =>
        onChange(Number((min + (next / 100) * (max - min)).toFixed(6)))
      }
    />
  );
}

const spinnerStyles = cva("shrink-0 motion-safe:animate-spin", {
  variants: {
    size: { control: "size-5", card: "size-[18cqw]!", fluid: "" },
  },
  defaultVariants: { size: "control" },
});

export function Spinner({
  size,
  className,
  ...props
}: Omit<LucideProps, "size"> & VariantProps<typeof spinnerStyles>) {
  return (
    <LoaderCircle
      aria-hidden="true"
      {...props}
      className={spinnerStyles({ size, className })}
    />
  );
}

export function MotionDiv({
  motionTransition,
  ...props
}: HTMLMotionProps<"div"> & {
  motionTransition?: Transition;
  ref?: Ref<HTMLDivElement>;
}) {
  return <m.div {...props} transition={motionTransition} />;
}

const buttonStyles = cva(
  "inline-flex items-center justify-center gap-2 rounded-md border border-solid font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-accent disabled:cursor-default disabled:opacity-50",
  {
    variants: {
      intent: {
        neutral:
          "border-ui-border bg-ui-background text-ui-text enabled:hover:not-aria-pressed:control-hover!",
        primary:
          "border-ui-accent bg-ui-accent text-ui-on-accent [--control-hover-base:var(--accent)] enabled:hover:control-hover",
        success:
          "border-emerald-400 bg-emerald-700 text-white [--control-hover-base:var(--color-emerald-700)] enabled:hover:control-hover focus-visible:outline-emerald-400",
        danger:
          "border-red-400/40 bg-red-500/10 text-red-300 [--control-hover-base:color-mix(in_srgb,var(--color-red-500)_10%,var(--panel))] enabled:hover:control-hover focus-visible:outline-red-400",
      },
      size: { regular: "", compact: "", fluid: "" },
      presentation: { text: "", icon: "shrink-0 p-0" },
    },
    compoundVariants: [
      {
        size: "regular",
        presentation: "text",
        className: "min-h-11 px-3 py-2 text-[11px]",
      },
      {
        size: "compact",
        presentation: "text",
        className: "min-h-8 px-2 py-1 text-xs",
      },
      {
        size: "regular",
        presentation: "icon",
        className: "size-11 text-[11px]",
      },
      {
        size: "compact",
        presentation: "icon",
        className: "size-8 text-xs",
      },
    ],
    defaultVariants: {
      intent: "neutral",
      size: "regular",
      presentation: "text",
    },
  },
);

export function Button({
  intent,
  size,
  presentation,
  className,
  ref,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonStyles> & { ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonStyles({ intent, size, presentation, className })}
      {...props}
    />
  );
}

export const joinedControlStyles = cva("isolate gap-0 bg-ui-background", {
  variants: {
    orientation: {
      horizontal: "[&>button+button]:-ml-px",
      vertical: "[&>button+button]:-mt-px",
    },
    shape: {
      square: "rounded-none [&>button]:rounded-none!",
      rounded: "rounded-md [&>button]:rounded-none!",
    },
  },
  compoundVariants: [
    {
      orientation: "horizontal",
      shape: "rounded",
      className:
        "[&>button:first-child]:rounded-l-md! [&>button:last-child]:rounded-r-md!",
    },
    {
      orientation: "vertical",
      shape: "rounded",
      className:
        "[&>button:first-child]:rounded-t-md! [&>button:last-child]:rounded-b-md!",
    },
  ],
  defaultVariants: { orientation: "horizontal", shape: "rounded" },
});

export const joinedChoiceStyles = cva(
  "relative flex min-h-11 min-w-0 items-center justify-center rounded-none border border-solid border-ui-border bg-ui-background py-2 text-ui-muted [--control-hover-base:var(--bg)] enabled:data-hover:control-hover enabled:hover:control-hover data-checked:bg-ui-selected data-checked:text-ui-accent data-selected:bg-ui-selected data-selected:text-ui-accent disabled:cursor-default! disabled:opacity-50 data-checked:disabled:opacity-100! data-selected:disabled:opacity-100! focus-visible:z-20 focus-visible:outline-2 focus-visible:-outline-offset-2! focus-visible:outline-ui-accent",
  {
    variants: {
      spacing: { compact: "gap-1 px-1", regular: "gap-2 px-2" },
    },
    defaultVariants: { spacing: "compact" },
  },
);

const radioGridStyles = cva("isolate grid gap-0 rounded-md bg-ui-background", {
  variants: {
    columns: {
      2: "grid-cols-2",
      3: "grid-cols-3",
    },
  },
});

export function ButtonGroup({
  label,
  orientation = "horizontal",
  className,
  children,
}: {
  label: string;
  orientation?: "horizontal" | "vertical";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      data-button-group={orientation}
      className={joinedControlStyles({
        orientation,
        className: clsx(
          "inline-flex [&>button]:relative [&>button]:bg-ui-background! [&>button[aria-pressed=true]]:bg-ui-selected! [&>button[aria-pressed=true]:enabled:hover]:border-ui-border! [&>button[aria-pressed=true]]:cursor-default! [&>button:not([aria-pressed=true]):hover]:z-10 [&>button:focus-visible]:z-20",
          orientation === "vertical" && "flex-col",
          className,
        ),
      })}
    >
      {children}
    </div>
  );
}

export function ChoiceButton({
  ref,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> }) {
  const disabled =
    props.disabled ||
    props["aria-disabled"] === true ||
    props["aria-disabled"] === "true";
  return (
    <button
      {...props}
      ref={ref}
      disabled={disabled}
      tabIndex={props.role === "radio" && !disabled ? 0 : props.tabIndex}
    />
  );
}

export function IconRadioField({
  id,
  label,
  value,
  options,
  columns,
  onChange,
  hideLabel = false,
}: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string; icon?: LucideIcon }[];
  columns: 2 | 3;
  onChange: (value: string) => void;
  hideLabel?: boolean;
}) {
  return (
    <RadioGroup
      id={id}
      value={value}
      onChange={onChange}
      className="@container/radio flex flex-col gap-2"
    >
      <Label className={hideLabel ? "sr-only" : "field-label"}>{label}</Label>
      <div className={radioGridStyles({ columns })}>
        {options.map(
          (
            { value: optionValue, label: optionLabel, icon: Icon },
            optionIndex,
          ) => (
            <Radio
              key={optionValue}
              as={ChoiceButton}
              type="button"
              value={optionValue}
              disabled={optionValue === value}
              data-value={optionValue}
              className={clsx(
                joinedChoiceStyles(),
                "data-hover:z-10",
                optionIndex % columns !== 0 && "-ml-px",
                optionIndex >= columns && "-mt-px",
                optionIndex === 0 && "rounded-tl-md",
                optionIndex === columns - 1 && "rounded-tr-md",
                optionIndex === options.length - columns && "rounded-bl-md",
                optionIndex === options.length - 1 && "rounded-br-md",
                columns === 3 &&
                  "@max-[260px]/radio:min-h-16 @max-[260px]/radio:flex-col",
              )}
            >
              {Icon && <Icon aria-hidden="true" className="size-4! shrink-0" />}
              <span
                className={clsx(
                  "min-w-0 text-xs leading-4 wrap-anywhere",
                  columns === 3 ? "text-center" : "text-left",
                )}
              >
                {optionLabel}
              </span>
            </Radio>
          ),
        )}
      </div>
    </RadioGroup>
  );
}

const selectTriggerStyles = cva(
  "flex min-h-11 w-full items-center justify-between gap-2 rounded-sm border border-solid border-ui-border bg-ui-background text-left enabled:data-hover:control-hover focus-visible:-outline-offset-3!",
  {
    variants: {
      compact: {
        true: "h-11 px-2",
        false: "px-4",
      },
      fontPreview: { true: "py-0", false: "" },
    },
    compoundVariants: [
      { compact: false, fontPreview: false, className: "py-2" },
      { compact: true, fontPreview: false, className: "py-0" },
    ],
  },
);

const popupStyles = cva(
  "z-70 w-(--button-width) max-w-[calc(100vw-24px)] rounded-sm border border-solid border-ui-border bg-ui-panel p-1 [--anchor-padding:12px] transition-opacity duration-(--ui-motion-popup,140ms) data-closed:opacity-0 motion-reduce:transition-none",
  {
    variants: {
      compact: {
        true: "min-w-42.5 [--anchor-gap:4px]",
        false:
          "data-[anchor^=bottom]:rounded-t-none data-[anchor^=bottom]:border-t-0 data-[anchor^=top]:rounded-b-none data-[anchor^=top]:border-b-0 [--anchor-gap:0px]",
      },
    },
  },
);

const selectOptionStyles = cva(
  "flex min-h-11 w-full items-center gap-2 rounded-none border-0 bg-transparent text-left cursor-pointer px-4 wrap-break-word [--control-hover-base:var(--panel)] enabled:hover:control-hover enabled:data-focus:control-hover data-selected:bg-ui-selected data-selected:text-ui-accent data-disabled:cursor-default! data-disabled:opacity-50 data-disabled:data-selected:opacity-100!",
  {
    variants: {
      fontPreview: {
        true: "py-0 text-[20px]! leading-7",
        false: "py-2 text-sm!",
      },
    },
  },
);

export function SelectField({
  id,
  label,
  value,
  valueLabel,
  options,
  onChange,
  compact = false,
  largeFontPreview = false,
}: {
  id: string;
  label: string;
  value: string;
  valueLabel?: string;
  options: {
    value: string;
    label: string;
    icon?: LucideIcon;
    fontFamily?: string;
    fontWeight?: number;
    disabled?: boolean;
    title?: string;
  }[];
  onChange: (value: string) => void;
  compact?: boolean;
  largeFontPreview?: boolean;
}) {
  const selected = options.find((option) => option.value === value);
  const SelectedIcon = selected?.icon;
  const [popup, setPopup] = useState<HTMLElement | null>(null);
  const [opensUp, setOpensUp] = useState(false);
  useEffect(() => {
    if (!popup || compact) return;
    const updateDirection = () => {
      setOpensUp(popup.dataset.anchor?.startsWith("top") ?? false);
    };
    updateDirection();
    const observer = new MutationObserver(updateDirection);
    observer.observe(popup, {
      attributes: true,
      attributeFilter: ["data-anchor"],
    });
    return () => observer.disconnect();
  }, [popup, compact]);
  return (
    <Listbox
      as={compact ? Fragment : "div"}
      className={compact ? undefined : "flex flex-col gap-2"}
      value={value}
      onChange={onChange}
    >
      <ListboxLabel className={compact ? "sr-only" : "field-label"}>
        {label}
      </ListboxLabel>
      <ListboxButton
        id={id}
        title={
          compact
            ? t("common.fields.value", {
                value1: label,
                value2: selected?.label ?? valueLabel ?? value,
              })
            : undefined
        }
        className={clsx(
          selectTriggerStyles({ compact, fontPreview: largeFontPreview }),
          !compact &&
            (opensUp ? "data-open:rounded-t-none" : "data-open:rounded-b-none"),
        )}
      >
        {SelectedIcon && (
          <SelectedIcon aria-hidden="true" className="size-4.5 shrink-0" />
        )}
        <span
          style={{
            fontFamily: selected?.fontFamily
              ? `"${selected.fontFamily}"`
              : undefined,
            fontWeight: selected?.fontWeight,
          }}
          className={clsx(
            compact
              ? "min-w-0 truncate text-[12px] max-[600px]:sr-only"
              : "min-w-0 wrap-break-word",
            largeFontPreview && "text-[20px] leading-7",
          )}
        >
          {selected?.label ?? valueLabel ?? value}
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0" />
      </ListboxButton>
      <ListboxOptions
        ref={setPopup}
        transition
        data-overlay-scroll="y"
        anchor="bottom"
        modal={false}
        className={popupStyles({ compact })}
      >
        {options.map((option) => {
          const OptionIcon = option.icon;
          return (
            <ListboxOption
              as={ChoiceButton}
              type="button"
              key={option.value}
              value={option.value}
              disabled={option.disabled || option.value === value}
              title={option.title}
              data-value={option.value}
              style={{
                fontFamily: option.fontFamily
                  ? `"${option.fontFamily}"`
                  : undefined,
                fontWeight: option.fontWeight,
              }}
              className={selectOptionStyles({ fontPreview: largeFontPreview })}
            >
              {OptionIcon && (
                <OptionIcon aria-hidden="true" className="size-4.5 shrink-0" />
              )}
              {option.label}
            </ListboxOption>
          );
        })}
      </ListboxOptions>
    </Listbox>
  );
}

export function TextAlignmentField({
  id,
  value = "center",
  onChange,
}: {
  id: string;
  value?: "left" | "center" | "right";
  onChange: (value: "left" | "center" | "right") => void;
}) {
  const choices = [
    { value: "left", label: t("settings.fields.alignLeft") },
    { value: "center", label: t("settings.fields.alignCenter") },
    { value: "right", label: t("settings.fields.alignRight") },
  ] as const;
  const selected = choices.findIndex((choice) => choice.value === value);
  return (
    <RangeField
      id={id}
      label={t("settings.fields.textAlignment")}
      min={0}
      max={2}
      step={1}
      value={selected}
      output={choices[selected].label}
      valueText={choices[selected].label}
      onChange={(index) => onChange(choices[index].value)}
    />
  );
}

export function ColorField({
  id,
  label,
  accessibleLabel = label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  accessibleLabel?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value.toUpperCase());
  useEffect(() => setDraft(value.toUpperCase()), [value]);
  const normalize = (text: string) =>
    /^#?[a-f\d]{6}$/i.test(text)
      ? `#${text.replace(/^#/, "").toLowerCase()}`
      : null;
  return (
    <div className="@container/color flex min-w-0 flex-col gap-0.5">
      <label
        className="field-label @max-[120px]/color:min-h-8 @max-[120px]/color:items-end!"
        htmlFor={id}
      >
        {label}
      </label>
      <DataInteractive
        as="div"
        className="flex w-full min-w-0 items-center overflow-hidden rounded-sm border border-solid border-ui-border bg-ui-background focus-within:border-ui-accent transition-colors"
      >
        <DataInteractive
          as="div"
          className="group/swatch relative box-content! h-11 w-11 shrink-0 overflow-hidden border-0 border-r border-solid border-ui-border"
          style={{ "--control-hover-base": value } as CSSProperties}
        >
          <DataInteractive
            as="input"
            id={id}
            type="color"
            value={value}
            aria-label={t("common.fields.colorPicker", {
              value1: accessibleLabel,
            })}
            title={t("common.fields.colorPicker", { value1: accessibleLabel })}
            className="h-full w-full cursor-pointer rounded-none! border-0 bg-transparent p-0! [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:border-0"
            onChange={(event) => onChange(event.target.value)}
          />
          <span
            aria-hidden="true"
            className="control-hover pointer-events-none absolute inset-0 opacity-0 transition-opacity group-data-hover/swatch:opacity-100"
          />
        </DataInteractive>
        <DataInteractive
          as="input"
          id={`${id}-value`}
          type="text"
          aria-label={t("common.fields.hexValue", { value1: accessibleLabel })}
          value={draft}
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          className="h-11! w-full min-w-0 flex-1 rounded-none! border-0! bg-transparent! px-2.5 text-center font-mono! text-xs! text-ui-text outline-none data-hover:control-hover! transition-colors @max-[120px]/color:px-px @max-[120px]/color:text-[10px]!"
          onChange={(event) => {
            setDraft(event.target.value);
            const color = normalize(event.target.value);
            if (color) onChange(color);
          }}
          onBlur={() => setDraft(value.toUpperCase())}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setDraft(value.toUpperCase());
              event.currentTarget.blur();
            } else if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </DataInteractive>
    </div>
  );
}

const disclosureTriggerStyles = cva(
  "relative flex w-full items-center text-left focus-visible:-outline-offset-3!",
  {
    variants: {
      level: {
        main: "min-h-14 gap-3 rounded-none! border-0! bg-transparent! py-3! pr-12! pl-3! text-sm! [--control-hover-base:var(--panel)] data-hover:control-hover!",
        customize:
          "min-h-11 cursor-pointer gap-2 rounded-sm border border-solid border-ui-border bg-ui-background px-3 py-2 text-xs text-ui-muted data-hover:control-hover hover:text-ui-text data-open:text-ui-text",
      },
    },
    defaultVariants: { level: "main" },
  },
);

export function DisclosureTrigger({
  level,
  className,
  ref,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof disclosureTriggerStyles> & {
    ref?: Ref<HTMLButtonElement>;
  }) {
  return (
    <DisclosureButton
      {...props}
      ref={ref}
      type={type}
      className={disclosureTriggerStyles({ level, className })}
    />
  );
}

export function DisclosureChevron({ open }: { open: boolean }) {
  const transition = useUiTransition("layout");
  return (
    <m.span
      aria-hidden="true"
      className="flex shrink-0"
      animate={{ rotate: open ? 180 : 0 }}
      transition={transition}
    >
      <ChevronDown className="size-4!" />
    </m.span>
  );
}

const switchStyles = cva(
  "relative h-6 w-11 shrink-0 rounded-full border-0 p-0 after:absolute after:-inset-y-2.5 after:inset-x-0 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-accent transition-colors motion-reduce:transition-none",
  {
    variants: {
      checked: {
        true: "bg-ui-accent [--control-hover-base:var(--accent)] enabled:hover:control-hover enabled:data-hover:control-hover",
        false:
          "bg-ui-selected [--control-hover-base:var(--selected)] [--control-hover-tint:var(--text)] enabled:hover:control-hover enabled:data-hover:control-hover",
      },
    },
  },
);

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  const transition = useUiTransition("control");
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-semibold">{label}</span>
      <Switch
        checked={checked}
        onChange={onChange}
        aria-label={label}
        className={switchStyles({ checked })}
      >
        <m.span
          aria-hidden="true"
          initial={false}
          animate={{ x: checked ? 20 : 0 }}
          transition={transition}
          className="absolute top-1 left-1 size-4 rounded-full bg-ui-panel"
        />
      </Switch>
    </div>
  );
}

export function AccordionPanel({
  children,
  onReveal,
}: {
  children: ReactNode;
  onReveal?: (panel: HTMLDivElement) => void;
}) {
  const present = useIsPresent();
  const transition = useUiTransition("layout");
  const panel = useRef<HTMLDivElement>(null);
  const reveal = () => {
    if (present && panel.current) onReveal?.(panel.current);
  };
  return (
    <DisclosurePanel
      static
      as={MotionDiv}
      ref={panel}
      inert={!present}
      aria-hidden={present ? undefined : true}
      {...motionPresets.collapse}
      motionTransition={transition}
      onUpdate={onReveal ? reveal : undefined}
      onAnimationComplete={onReveal ? reveal : undefined}
      className="overflow-hidden"
    >
      {children}
    </DisclosurePanel>
  );
}
