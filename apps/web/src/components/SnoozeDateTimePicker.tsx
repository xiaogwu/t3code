import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "~/lib/utils";

import { formatSnoozeForInput, parseSnoozeForInput } from "./Sidebar.snooze";
import { Button } from "./ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";

const ROW_HEIGHT = 36;
const LOOP_COUNT = 7;
const CENTER_LOOP = Math.floor(LOOP_COUNT / 2);

function loopingValues(values: readonly number[]): readonly number[] {
  return Array.from(
    { length: values.length * LOOP_COUNT },
    (_, index) => values[index % values.length]!,
  );
}

function LoopingTimeColumn(props: {
  readonly label: string;
  readonly values: readonly number[];
  readonly value: number;
  readonly format: (value: number) => string;
  readonly onChange: (value: number) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const repeated = useMemo(() => loopingValues(props.values), [props.values]);

  const pinToTop = (value: number, behavior: ScrollBehavior = "smooth") => {
    const valueIndex = props.values.indexOf(value);
    viewportRef.current?.scrollTo({
      top: (CENTER_LOOP * props.values.length + valueIndex) * ROW_HEIGHT,
      behavior,
    });
  };

  useEffect(() => pinToTop(props.value, "auto"), [props.value]);

  return (
    <div className="min-w-14">
      <div className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">{props.label}</div>
      <div
        ref={viewportRef}
        className="h-36 snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-md bg-muted/35 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={(event) => {
          const viewport = event.currentTarget;
          const cycleHeight = props.values.length * ROW_HEIGHT;
          if (
            viewport.scrollTop < cycleHeight ||
            viewport.scrollTop > cycleHeight * (LOOP_COUNT - 2)
          ) {
            viewport.scrollTop = CENTER_LOOP * cycleHeight + (viewport.scrollTop % cycleHeight);
          }
        }}
      >
        {repeated.map((candidate, index) => (
          <button
            key={`${candidate}-${index}`}
            type="button"
            className={cn(
              "flex h-9 w-full snap-start items-center justify-center rounded-md text-sm tabular-nums hover:bg-accent hover:text-accent-foreground",
              candidate === props.value && "bg-primary text-primary-foreground hover:bg-primary",
            )}
            aria-label={`${props.label} ${props.format(candidate)}`}
            aria-pressed={candidate === props.value}
            onClick={() => {
              props.onChange(candidate);
              pinToTop(candidate);
            }}
          >
            {props.format(candidate)}
          </button>
        ))}
      </div>
    </div>
  );
}

function monthDays(month: Date): readonly Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function selectedDate(value: string): Date {
  const parsed = parseSnoozeForInput(value, { now: new Date(0) });
  return parsed.ok ? parsed.value : new Date();
}

export function SnoozeDateTimePicker(props: {
  readonly id: string;
  readonly value: string;
  readonly invalid: boolean;
  readonly describedBy?: string;
  readonly onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => selectedDate(props.value), [props.value]);
  const [month, setMonth] = useState(
    () => new Date(selected.getFullYear(), selected.getMonth(), 1),
  );
  const days = useMemo(() => monthDays(month), [month]);
  const usesTwelveHourTime = useMemo(
    () => new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12 === true,
    [],
  );
  const hourValues = useMemo(
    () =>
      usesTwelveHourTime
        ? Array.from({ length: 12 }, (_, index) => index + 1)
        : Array.from({ length: 24 }, (_, index) => index),
    [usesTwelveHourTime],
  );
  const minuteValues = useMemo(() => Array.from({ length: 60 }, (_, index) => index), []);
  const displayHour = usesTwelveHourTime ? selected.getHours() % 12 || 12 : selected.getHours();

  const update = (mutate: (next: Date) => void) => {
    const next = new Date(selected);
    mutate(next);
    props.onChange(formatSnoozeForInput(next));
  };

  const displayValue = selected.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={props.id}
        aria-invalid={props.invalid}
        aria-describedby={props.describedBy}
        className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20"
      >
        <span className="tabular-nums">{displayValue}</span>
        <CalendarIcon className="size-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverPopup
        align="start"
        className="w-[min(34rem,calc(100vw-2rem))] rounded-lg"
        viewportClassName="p-3"
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Previous month"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              >
                <ChevronLeftIcon />
              </Button>
              <span className="text-sm font-semibold">
                {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
              </span>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Next month"
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              >
                <ChevronRightIcon />
              </Button>
            </div>
            <div className="grid grid-cols-7 text-center text-[11px] font-medium text-muted-foreground">
              {Array.from({ length: 7 }, (_, index) => (
                <div key={index} className="py-1">
                  {new Date(2026, 7, 2 + index).toLocaleDateString(undefined, {
                    weekday: "narrow",
                  })}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {days.map((day) => (
                <button
                  key={day.toISOString()}
                  type="button"
                  className={cn(
                    "size-8 rounded-md text-sm tabular-nums hover:bg-accent hover:text-accent-foreground",
                    day.getMonth() !== month.getMonth() && "text-muted-foreground/45",
                    sameDay(day, selected) && "bg-primary text-primary-foreground hover:bg-primary",
                  )}
                  aria-pressed={sameDay(day, selected)}
                  onClick={() =>
                    update((next) =>
                      next.setFullYear(day.getFullYear(), day.getMonth(), day.getDate()),
                    )
                  }
                >
                  {day.getDate()}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 border-border sm:border-l sm:pl-4">
            <LoopingTimeColumn
              label="Hour"
              values={hourValues}
              value={displayHour}
              format={(value) => String(value).padStart(2, "0")}
              onChange={(value) =>
                update((next) =>
                  next.setHours(
                    usesTwelveHourTime
                      ? next.getHours() >= 12
                        ? (value % 12) + 12
                        : value % 12
                      : value,
                  ),
                )
              }
            />
            <LoopingTimeColumn
              label="Minute"
              values={minuteValues}
              value={selected.getMinutes()}
              format={(value) => String(value).padStart(2, "0")}
              onChange={(value) => update((next) => next.setMinutes(value))}
            />
            {usesTwelveHourTime ? (
              <div className="min-w-14">
                <div className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">
                  Period
                </div>
                <div className="overflow-hidden rounded-md bg-muted/35">
                  {["AM", "PM"].map((period) => {
                    const selectedPeriod = selected.getHours() >= 12 ? "PM" : "AM";
                    return (
                      <button
                        key={period}
                        type="button"
                        className={cn(
                          "flex h-9 w-full items-center justify-center rounded-md text-sm hover:bg-accent hover:text-accent-foreground",
                          period === selectedPeriod &&
                            "bg-primary text-primary-foreground hover:bg-primary",
                        )}
                        aria-pressed={period === selectedPeriod}
                        onClick={() =>
                          update((next) =>
                            next.setHours((next.getHours() % 12) + (period === "PM" ? 12 : 0)),
                          )
                        }
                      >
                        {period}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
