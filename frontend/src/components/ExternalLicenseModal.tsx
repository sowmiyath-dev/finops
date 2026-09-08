"use client";
import { useEffect, useRef, useState } from "react";
import { X, Plus, Trash2, Save, RefreshCw, RotateCcw } from "lucide-react";
import api from "@/lib/api";
import toast from "react-hot-toast";

interface LicenseRow {
  id?: string;
  sno: number;
  description: string;
  team: string;
  unit_cost_pa: number;
  unit_cost_pm: number;
  dc_units: number;
  dr_units: number;
  uat_units: number;
  // computed (read-only display)
  dc_cost?: number;
  dr_cost?: number;
  uat_cost?: number;
  total_units?: number;
  total_cost?: number;
}

function compute(row: LicenseRow) {
  const pm = row.unit_cost_pm;
  const dc_cost = row.dc_units * pm;
  const dr_cost = row.dr_units * pm;
  const uat_cost = row.uat_units * pm;
  return {
    dc_cost,
    dr_cost,
    uat_cost,
    total_units: row.dc_units + row.dr_units + row.uat_units,
    total_cost: dc_cost + dr_cost + uat_cost,
  };
}

function fmtINR(v: number) {
  if (v === 0) return "₹ 0";
  return "₹ " + v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function NumCell({
  value,
  onChange,
  prefix,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);

  const commit = () => {
    const n = parseFloat(draft);
    onChange(isNaN(n) ? 0 : n);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(String(value)); setEditing(false); } }}
        className={`w-full text-right text-xs font-mono border border-blue-400 rounded px-1 py-0.5 outline-none bg-blue-50 ${className ?? ""}`}
      />
    );
  }
  return (
    <div
      onClick={() => { setDraft(String(value)); setEditing(true); }}
      className={`text-right text-xs font-mono cursor-pointer hover:bg-blue-50 rounded px-1 py-0.5 select-none ${className ?? ""}`}
    >
      {prefix}{value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
    </div>
  );
}

function TextCell({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);

  const commit = () => { onChange(draft); setEditing(false); };

  if (editing) {
    return (
      <input
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value); setEditing(false); } }}
        className={`w-full text-xs border border-blue-400 rounded px-1 py-0.5 outline-none bg-blue-50 ${className ?? ""}`}
      />
    );
  }
  return (
    <div
      onClick={() => { setDraft(value); setEditing(true); }}
      className={`text-xs cursor-pointer hover:bg-blue-50 rounded px-1 py-0.5 select-none truncate ${className ?? ""}`}
    >
      {value || <span className="text-slate-300 italic">click to edit</span>}
    </div>
  );
}

export default function ExternalLicenseModal({
  appName,
  onClose,
}: {
  appName: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<LicenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const loadRows = () => {
    setLoading(true);
    api.get(`/external-licenses/${encodeURIComponent(appName)}`)
      .then((r) => setRows(r.data))
      .catch(() => toast.error("Failed to load licenses"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadRows(); }, [appName]); // eslint-disable-line

  const update = (i: number, patch: Partial<LicenseRow>) => {
    setRows((prev) => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  };

  const addRow = () => {
    const nextSno = rows.length > 0 ? Math.max(...rows.map((r) => r.sno)) + 1 : 1;
    setRows((prev) => [...prev, {
      sno: nextSno, description: "", team: "", unit_cost_pa: 0, unit_cost_pm: 0,
      dc_units: 0, dr_units: 0, uat_units: 0,
    }]);
  };

  const deleteRow = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/external-licenses/${encodeURIComponent(appName)}`, { rows });
      toast.success("Saved");
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = async () => {
    if (!confirm("Reset to default 21 licenses? All custom changes will be lost.")) return;
    setResetting(true);
    try {
      await api.post(`/external-licenses/${encodeURIComponent(appName)}/reset`);
      toast.success("Reset to defaults");
      loadRows();
    } catch {
      toast.error("Reset failed");
    } finally {
      setResetting(false);
    }
  };

  // Totals
  const totals = rows.reduce(
    (acc, r) => {
      const c = compute(r);
      return {
        dc_cost: acc.dc_cost + c.dc_cost,
        dr_cost: acc.dr_cost + c.dr_cost,
        uat_cost: acc.uat_cost + c.uat_cost,
        total_units: acc.total_units + c.total_units,
        total_cost: acc.total_cost + c.total_cost,
      };
    },
    { dc_cost: 0, dr_cost: 0, uat_cost: 0, total_units: 0, total_cost: 0 }
  );

  const thCls = "px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-white text-center whitespace-nowrap border-r border-blue-700/40 last:border-0";
  const tdCls = "px-1 py-1 border-r border-slate-100 last:border-0 align-middle";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl flex flex-col" style={{ width: "min(98vw, 1400px)", maxHeight: "92vh" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 rounded-t-xl" style={{ background: "linear-gradient(135deg,#0f2d5e 0%,#1a6fa8 100%)" }}>
          <div>
            <h2 className="text-sm font-extrabold text-white">External License Cost</h2>
            <p className="text-blue-200 text-[11px] mt-0.5">{appName} · Click any cell to edit · Costs auto-calculated</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={addRow} className="flex items-center gap-1 px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-bold rounded-lg transition">
              <Plus className="w-3.5 h-3.5" /> Add Row
            </button>
            <button onClick={resetToDefaults} disabled={resetting} className="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-lg transition disabled:opacity-60" title="Reset to 21 default licenses">
              {resetting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Reset
            </button>
            <button onClick={save} disabled={saving} className="flex items-center gap-1 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg transition disabled:opacity-60">
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {saving ? "Saving..." : "Save"}
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/20 text-white transition"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-slate-400 text-sm">Loading...</div>
          ) : (
            <table className="w-full text-xs" style={{ borderCollapse: "collapse", minWidth: 1100 }}>
              <thead className="sticky top-0 z-10">
                {/* Group header row */}
                <tr style={{ background: "#0f2d5e" }}>
                  <th className={thCls} rowSpan={2} style={{ width: 36 }}>S.No</th>
                  <th className={thCls} rowSpan={2} style={{ minWidth: 160 }}>Description</th>
                  <th className={thCls} rowSpan={2} style={{ width: 70 }}>Team</th>
                  <th className={thCls} rowSpan={2} style={{ width: 100 }}>Unit Cost P.A</th>
                  <th className={thCls} rowSpan={2} style={{ width: 100 }}>Unit Cost P.M</th>
                  <th className={thCls} colSpan={2} style={{ background: "#1a4a8a" }}>MUM - DC</th>
                  <th className={thCls} colSpan={2} style={{ background: "#1a5c6e" }}>HYD - DR</th>
                  <th className={thCls} colSpan={2} style={{ background: "#2d5a1a" }}>UAT</th>
                  <th className={thCls} colSpan={2} style={{ background: "#5a1a1a" }}>TOTAL</th>
                  <th className={thCls} rowSpan={2} style={{ width: 36 }}></th>
                </tr>
                <tr style={{ background: "#1e3a6e" }}>
                  <th className={thCls} style={{ width: 70, background: "#1a4a8a" }}>Units</th>
                  <th className={thCls} style={{ width: 100, background: "#1a4a8a" }}>Cost P.M</th>
                  <th className={thCls} style={{ width: 70, background: "#1a5c6e" }}>Units</th>
                  <th className={thCls} style={{ width: 100, background: "#1a5c6e" }}>Cost P.M</th>
                  <th className={thCls} style={{ width: 70, background: "#2d5a1a" }}>Units</th>
                  <th className={thCls} style={{ width: 100, background: "#2d5a1a" }}>Cost P.M</th>
                  <th className={thCls} style={{ width: 70, background: "#5a1a1a" }}>Units</th>
                  <th className={thCls} style={{ width: 110, background: "#5a1a1a" }}>Cost P.M</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const c = compute(row);
                  const isEven = i % 2 === 0;
                  return (
                    <tr key={i} style={{ background: isEven ? "#fff" : "#f8faff", borderBottom: "1px solid #e2e8f0" }}>
                      <td className={tdCls + " text-center text-slate-400 font-mono"}>{row.sno}</td>
                      <td className={tdCls}>
                        <TextCell value={row.description} onChange={(v) => update(i, { description: v })} />
                      </td>
                      <td className={tdCls}>
                        <TextCell value={row.team} onChange={(v) => update(i, { team: v })} className="text-center" />
                      </td>
                      <td className={tdCls}>
                        <NumCell value={row.unit_cost_pa} onChange={(v) => update(i, { unit_cost_pa: v, unit_cost_pm: Math.round(v / 12) })} prefix="₹ " className="text-slate-700" />
                      </td>
                      <td className={tdCls}>
                        <NumCell value={row.unit_cost_pm} onChange={(v) => update(i, { unit_cost_pm: v })} prefix="₹ " className="text-slate-700" />
                      </td>
                      {/* DC */}
                      <td className={tdCls} style={{ background: isEven ? "#eef4ff" : "#e6f0ff" }}>
                        <NumCell value={row.dc_units} onChange={(v) => update(i, { dc_units: v })} className="text-blue-800" />
                      </td>
                      <td className={tdCls} style={{ background: isEven ? "#eef4ff" : "#e6f0ff" }}>
                        <div className="text-right text-xs font-mono text-blue-700 px-1 py-0.5">{fmtINR(c.dc_cost)}</div>
                      </td>
                      {/* DR */}
                      <td className={tdCls} style={{ background: isEven ? "#edfaf8" : "#e0f5f2" }}>
                        <NumCell value={row.dr_units} onChange={(v) => update(i, { dr_units: v })} className="text-teal-800" />
                      </td>
                      <td className={tdCls} style={{ background: isEven ? "#edfaf8" : "#e0f5f2" }}>
                        <div className="text-right text-xs font-mono text-teal-700 px-1 py-0.5">{fmtINR(c.dr_cost)}</div>
                      </td>
                      {/* UAT */}
                      <td className={tdCls} style={{ background: isEven ? "#f0fae8" : "#e8f5e0" }}>
                        <NumCell value={row.uat_units} onChange={(v) => update(i, { uat_units: v })} className="text-green-800" />
                      </td>
                      <td className={tdCls} style={{ background: isEven ? "#f0fae8" : "#e8f5e0" }}>
                        <div className="text-right text-xs font-mono text-green-700 px-1 py-0.5">{fmtINR(c.uat_cost)}</div>
                      </td>
                      {/* Total */}
                      <td className={tdCls} style={{ background: isEven ? "#fff5f5" : "#ffe8e8" }}>
                        <div className="text-right text-xs font-mono font-bold text-red-800 px-1 py-0.5">{c.total_units.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</div>
                      </td>
                      <td className={tdCls} style={{ background: isEven ? "#fff5f5" : "#ffe8e8" }}>
                        <div className="text-right text-xs font-mono font-bold text-red-700 px-1 py-0.5">{fmtINR(c.total_cost)}</div>
                      </td>
                      <td className={tdCls + " text-center"}>
                        <button onClick={() => deleteRow(i)} className="p-1 rounded hover:bg-red-100 text-red-400 hover:text-red-600 transition">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Totals row */}
              <tfoot>
                <tr style={{ background: "#0f2d5e", borderTop: "2px solid #1a6fa8" }}>
                  <td colSpan={5} className="px-3 py-2 text-xs font-extrabold text-white">TOTAL</td>
                  <td className="px-2 py-2 text-right text-xs font-bold text-blue-200 font-mono"></td>
                  <td className="px-2 py-2 text-right text-xs font-bold text-blue-200 font-mono">{fmtINR(totals.dc_cost)}</td>
                  <td className="px-2 py-2 text-right text-xs font-bold text-teal-200 font-mono"></td>
                  <td className="px-2 py-2 text-right text-xs font-bold text-teal-200 font-mono">{fmtINR(totals.dr_cost)}</td>
                  <td className="px-2 py-2 text-right text-xs font-bold text-green-200 font-mono"></td>
                  <td className="px-2 py-2 text-right text-xs font-bold text-green-200 font-mono">{fmtINR(totals.uat_cost)}</td>
                  <td className="px-2 py-2 text-right text-xs font-bold text-red-200 font-mono">{totals.total_units.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                  <td className="px-2 py-2 text-right text-xs font-bold text-white font-mono">{fmtINR(totals.total_cost)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-5 py-2 border-t border-slate-100 flex items-center justify-between">
          <p className="text-[10px] text-slate-400">
            Cost P.M = Units × Unit Cost P.M &nbsp;·&nbsp; Total = DC + DR + UAT &nbsp;·&nbsp; Click any cell to edit
          </p>
          <p className="text-[10px] text-slate-400 font-mono">
            Grand Total: <span className="font-bold text-slate-700">{fmtINR(totals.total_cost)}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
