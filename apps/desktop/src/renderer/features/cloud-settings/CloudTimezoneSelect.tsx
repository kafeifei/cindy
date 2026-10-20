import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { COMMON_TIMEZONES, timezoneChoices, timezoneOffset } from './timezones';

/** Search narrows existing choices only; arbitrary text never becomes a policy value. */
export function CloudTimezoneSelect({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange(value: string): void;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const options = useMemo(
    () =>
      timezoneChoices(value).map((zone) => ({
        value: zone,
        label: `${
          COMMON_TIMEZONES[zone]
            ? t(`cloudSettings.instance.timezoneCities.${COMMON_TIMEZONES[zone]}`)
            : zone.split('/').slice(1).join(' / ').replaceAll('_', ' ') || zone
        } · ${timezoneOffset(zone)}`,
      })),
    [value, i18n.language, t, open],
  );
  const filtered = options.filter((option) =>
    `${option.label} ${option.value}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const selected = options.find((option) => option.value === value);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open, query]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const choose = (zone: string) => {
    if (disabled) return;
    onChange(zone);
    setOpen(false);
  };
  const title = t('cloudSettings.instance.timezone');
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setQuery('');
          setActive(
            Math.max(
              0,
              options.findIndex((option) => option.value === value),
            ),
          );
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="lg"
          pressFeedback={false}
          disabled={disabled}
          aria-label={title}
          className="w-full min-w-0 justify-between gap-2 px-3 font-normal"
          title={`${selected?.label ?? value} (${value})`}
        >
          <span className="min-w-0 truncate">{selected?.label ?? value}</span>
          <ChevronDown size={14} className="shrink-0" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={8}
        className="flex w-[var(--radix-popover-trigger-width)] max-w-[var(--radix-popover-content-available-width)] max-h-[var(--radix-popover-content-available-height)] flex-col overflow-hidden p-1.5 shadow-none"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus();
        }}
      >
        <Input
          className="shrink-0"
          inputRef={input}
          role="combobox"
          aria-expanded="true"
          aria-controls={id}
          aria-activedescendant={filtered[active] ? `${id}-${active}` : undefined}
          aria-autocomplete="list"
          aria-label={t('cloudSettings.instance.timezoneSearch')}
          placeholder={t('cloudSettings.instance.timezoneSearch')}
          value={query}
          onChange={(next) => {
            setQuery(next);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((n) =>
                Math.max(
                  0,
                  Math.min(filtered.length - 1, n + (event.key === 'ArrowDown' ? 1 : -1)),
                ),
              );
            } else if (
              event.key === 'Enter' &&
              !event.nativeEvent.isComposing &&
              filtered[active]
            ) {
              event.preventDefault();
              choose(filtered[active].value);
            }
          }}
        />
        <div
          id={id}
          ref={list}
          role="listbox"
          aria-label={title}
          className="mt-1.5 min-h-0 max-h-64 overflow-y-auto"
        >
          {filtered.map((option, index) => (
            <div
              key={option.value}
              id={`${id}-${index}`}
              role="option"
              data-index={index}
              aria-selected={option.value === value}
              onMouseDown={(event) => event.preventDefault()}
              onPointerMove={() => setActive(index)}
              onClick={() => choose(option.value)}
              className={`flex min-h-8 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-13 text-[var(--text-primary)] ${index === active ? 'bg-[var(--surface-hover)]' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate" title={option.label}>
                  {option.label}
                </div>
                <div className="truncate text-12 text-[var(--text-secondary)]" title={option.value}>
                  {option.value}
                </div>
              </div>
              {option.value === value && <Check size={14} className="shrink-0" aria-hidden />}
            </div>
          ))}
          {!filtered.length && (
            <p role="status" className="p-3 text-13 text-[var(--text-secondary)]">
              {t('cloudSettings.instance.timezoneEmpty')}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
