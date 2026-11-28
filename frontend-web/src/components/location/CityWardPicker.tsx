import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { rankWards, useCities, useWards, WARD_TYPE_LABEL, type Ward } from '../../utils/wards';

export interface CityWardValue {
  cityId: number | null;
  wardId: number | null;
}

interface CityWardPickerProps {
  value: CityWardValue;
  /** `ward` is the picked ward, or null while the typed text matches none. */
  onChange: (value: CityWardValue, ward: Ward | null) => void;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  /** One field per row, for narrow panels. */
  stacked?: boolean;
  /** Text of the empty city option. */
  cityPlaceholder?: string;
}

const fieldClass =
  'w-full rounded-xl border px-3 py-2.5 text-dark-900 placeholder:text-dark-400 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-dark-50 disabled:text-dark-400';

/**
 * City first, then the ward: typing suggests the closest wards of that city and
 * only a ward picked from the suggestions counts, so the saved value is always
 * an official ward.
 */
export const CityWardPicker: React.FC<CityWardPickerProps> = ({ value, onChange, error, required, disabled, stacked, cityPlaceholder = 'Select city' }) => {
  const id = useId();
  const { cities, error: citiesError } = useCities();
  const { wards, loading } = useWards(value.cityId);
  const selectedWard = useMemo(() => wards.find((ward) => ward.id === value.wardId) || null, [wards, value.wardId]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [touched, setTouched] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Show the saved ward's name once the list has loaded (and after a city change).
  useEffect(() => {
    if (selectedWard) setQuery(selectedWard.name);
  }, [selectedWard]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const suggestions = useMemo(() => rankWards(wards, selectedWard ? '' : query), [wards, query, selectedWard]);

  const pick = (ward: Ward) => {
    setQuery(ward.name);
    setOpen(false);
    setTouched(true);
    onChange({ cityId: value.cityId, wardId: ward.id }, ward);
  };

  const unpicked = touched && !value.wardId && query.trim().length > 0;
  const wardMessage = error
    || (unpicked ? 'Pick your ward from the suggestions; typed text alone cannot be saved.' : '');

  return (
    <div className={stacked ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-1 sm:grid-cols-5 gap-3'}>
      <div className={stacked ? '' : 'sm:col-span-2'}>
        <label htmlFor={`${id}-city`} className="block text-sm font-medium text-dark-700 mb-2">
          City{required ? ' *' : ''}
        </label>
        <select
          id={`${id}-city`}
          className={`${fieldClass} border-dark-300 bg-white`}
          value={value.cityId ?? ''}
          disabled={disabled}
          onChange={(event) => {
            const cityId = event.target.value ? Number(event.target.value) : null;
            setQuery('');
            setTouched(false);
            onChange({ cityId, wardId: null }, null);
          }}
        >
          <option value="">{cityPlaceholder}</option>
          {cities.map((city) => (
            <option key={city.id} value={city.id}>{city.name}</option>
          ))}
        </select>
        {citiesError && <p className="text-sm text-danger-600 mt-1">Could not load cities. Refresh to try again.</p>}
      </div>

      <div className={stacked ? 'relative' : 'sm:col-span-3 relative'} ref={boxRef}>
        <label htmlFor={`${id}-ward`} className="block text-sm font-medium text-dark-700 mb-2">
          Ward / commune{required ? ' *' : ''}
        </label>
        <input
          id={`${id}-ward`}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-ward-list`}
          aria-autocomplete="list"
          autoComplete="off"
          className={`${fieldClass} ${wardMessage ? 'border-danger-500' : 'border-dark-300'}`}
          placeholder={!value.cityId ? 'Choose a city first' : loading ? 'Loading wards...' : 'Type your ward, e.g. Ben Thanh'}
          disabled={disabled || !value.cityId}
          value={query}
          onFocus={() => setOpen(true)}
          onBlur={() => setTouched(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setHighlight(0);
            if (value.wardId) onChange({ cityId: value.cityId, wardId: null }, null);
          }}
          onKeyDown={(event) => {
            if (!open || suggestions.length === 0) return;
            if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight((h) => Math.min(h + 1, suggestions.length - 1)); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); }
            if (event.key === 'Enter') { event.preventDefault(); pick(suggestions[highlight]); }
            if (event.key === 'Escape') setOpen(false);
          }}
        />
        {open && value.cityId && !selectedWard && (
          <ul
            id={`${id}-ward-list`}
            role="listbox"
            className="absolute z-30 mt-1 w-full max-h-64 overflow-auto rounded-xl border border-dark-200 bg-white shadow-lg"
          >
            {suggestions.length === 0 ? (
              <li className="px-3 py-2 text-sm text-dark-500">{loading ? 'Loading...' : 'No ward matches that name'}</li>
            ) : suggestions.map((ward, index) => (
              <li
                key={ward.id}
                role="option"
                aria-selected={index === highlight}
                onMouseDown={(event) => { event.preventDefault(); pick(ward); }}
                onMouseEnter={() => setHighlight(index)}
                className={`flex items-center justify-between gap-2 px-3 py-2 cursor-pointer text-sm ${index === highlight ? 'bg-primary-50 text-primary-800' : 'text-dark-800'}`}
              >
                <span>{ward.name}</span>
                <span className="text-xs text-dark-400">{WARD_TYPE_LABEL[ward.type]}</span>
              </li>
            ))}
          </ul>
        )}
        {wardMessage && <p className="text-sm text-danger-600 mt-1">{wardMessage}</p>}
      </div>
    </div>
  );
};
