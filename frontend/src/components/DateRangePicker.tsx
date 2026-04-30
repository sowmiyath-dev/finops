"use client";
import { useState, useRef, useEffect } from "react";
import { Calendar, ChevronDown } from "lucide-react";

export type DateRange = { start: string; end: string; label: string };

function getThisMonth(boundary: string): DateRange {
  const end = new Date(boundary);
  const start = new Date(end.getFullYear(), end.getMonth(), 1);
  return {
    start: start.toISOString().slice(0, 10),
    end: boundary,
    label: "This Month",
  };
}

function getLastMonth(boundary: string): DateRange {
  const ref = new Date(boundary);
  const start = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
  const end = new Date(ref.getFullYear(), ref.getMonth(), 0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    label: "Last Month",
  };
}

function getLast7(boundary: string): DateRange {
  const end = new Date(boundary);
  const start = new Date(end);
  start.setDate(start.getDate() - 6);
  return { start: start.toISOString().slice(0, 10), end: boundary, label: "Last 7 Days" };
}

function getLast30(boundary: string): DateRange {
  const end = new Date(boundary);
  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  return { start: start.toISOString().slice(0, 10), end: boundary, label: "Last 30 Days" };
}

function getLast90(boundary: string): DateRange {
  const end = new Date(boundary);
  const start = new Date(end);
  start.setDate(start.getDate() - 89);
  return { start: start.toISOString().slice(0, 10), end: boundary, label: "Last 90 Days" };
}

interface Props {
  boundary: string;
  value: DateRange;
  onChange: (range: DateRange) => void;
}

export default function DateRangePicker({ boundary, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [customStart, setCustomStart] = useState(value.start);
  const [customEnd, setCustomEnd] = useState(value.end);
  const [showCustom, setShowCustom] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const presets = [
    getLast7(boundary),
    getLast30(boundary),
    getLast90(boundary),
    getThisMonth(boundary),
    getLastMonth(boundary),
  ];

  const select = (range: DateRange) => {
    onChange(range);
    setShowCustom(false);
    setOpen(false);
  };

  const applyCustom = () => {
    if (customStart && customEnd && customStart <= customEnd) {
      onChange({ start: customStart, end: customEnd, label: `${customStart} → ${customEnd}` });
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-md text-sm font-semibold text-black hover:border-blue-900 transition"
      >
        <Calendar className="w-4 h-4 text-blue-900" />
        {value.label}
        <ChevronDown className="w-3.5 h-3.5 text-black" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-300 rounded-lg shadow-lg w-64">
          <div className="p-2 border-b border-gray-200">
            <p className="text-xs font-bold uppercase tracking-wide text-black px-2 py-1">Quick Select</p>
            {presets.map((p) => (
              <button key={p.label} onClick={() => select(p)}
                className={`w-full text-left px-3 py-2 text-sm rounded-md transition font-medium ${
                  value.label === p.label
                    ? "bg-blue-900 text-white"
                    : "text-black hover:bg-blue-50"
                }`}>
                {p.label}
                <span className="text-xs ml-2 opacity-70">{p.start} → {p.end}</span>
              </button>
            ))}
          </div>

          <div className="p-3">
            <button onClick={() => setShowCustom(!showCustom)}
              className="w-full text-left text-sm font-bold text-blue-900 hover:text-blue-700 transition mb-2">
              {showCustom ? "▾" : "▸"} Custom Range
            </button>
            {showCustom && (
              <div className="space-y-2">
                <div>
                  <label className="text-xs font-bold text-black block mb-1">Start Date</label>
                  <input type="date" value={customStart} max={boundary}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="w-full border border-gray-400 rounded px-2 py-1.5 text-sm text-black focus:outline-none focus:border-blue-900" />
                </div>
                <div>
                  <label className="text-xs font-bold text-black block mb-1">End Date</label>
                  <input type="date" value={customEnd} max={boundary}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="w-full border border-gray-400 rounded px-2 py-1.5 text-sm text-black focus:outline-none focus:border-blue-900" />
                </div>
                <button onClick={applyCustom}
                  className="w-full py-2 bg-blue-900 text-white text-sm font-bold rounded-md hover:bg-blue-800 transition">
                  Apply
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { getThisMonth, getLastMonth, getLast30 };
