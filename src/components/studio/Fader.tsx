import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";

type FaderProps = {
  value: number;
  onChange: (v: number) => void;
  label: string;
  orientation?: "vertical" | "horizontal";
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  capClassName?: string;
};

/** Console-style fader: dark groove with a ribbed cap. */
export function Fader({
  value,
  onChange,
  label,
  orientation = "vertical",
  min = 0,
  max = 1,
  step = 0.01,
  className,
  capClassName,
}: FaderProps) {
  const vertical = orientation === "vertical";
  return (
    <SliderPrimitive.Root
      aria-label={label}
      orientation={orientation}
      min={min}
      max={max}
      step={step}
      value={[value]}
      onValueChange={(v) => onChange(v[0] ?? value)}
      className={cn(
        "relative flex touch-none select-none items-center justify-center",
        vertical ? "h-full w-9 flex-col" : "h-9 w-full",
        className,
      )}
    >
      <SliderPrimitive.Track
        className={cn("relative grow rounded-full bg-groove", vertical ? "h-full w-1.5" : "h-1.5 w-full")}
      >
        <SliderPrimitive.Range className="absolute rounded-full bg-muted-foreground/30" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        className={cn(
          "fader-cap relative block rounded-[3px] border border-border shadow-md outline-none transition-[box-shadow] focus-visible:ring-2 focus-visible:ring-ring",
          vertical ? "h-9 w-8" : "h-8 w-6",
          capClassName,
        )}
      >
        <span
          className={cn("absolute bg-foreground/80", vertical ? "inset-x-1 top-1/2 h-0.5 -translate-y-1/2" : "inset-y-1 left-1/2 w-0.5 -translate-x-1/2")}
        />
      </SliderPrimitive.Thumb>
    </SliderPrimitive.Root>
  );
}
