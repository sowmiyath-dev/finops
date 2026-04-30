"use client";
import { AlertTriangle, Clock } from "lucide-react";
export default function SettingsAlertRulesPage() {
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <AlertTriangle className="w-6 h-6 text-blue-900" />
        <div>
          <h1 className="text-2xl font-bold text-black">Alert Rules</h1>
          <p className="text-sm text-black mt-0.5">Configure cost threshold and anomaly alert rules</p>
        </div>
      </div>
      <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-16 text-center">
        <Clock className="w-12 h-12 text-blue-900 mx-auto mb-4" />
        <h2 className="text-lg font-bold text-black mb-2">Coming Soon</h2>
        <p className="text-sm text-black max-w-md mx-auto mb-6">
          Define alert rules for budget thresholds, cost spikes, and anomaly detection across all cloud providers.
        </p>
        <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto text-left">
          {["Budget threshold rules","% increase alerts","Absolute cost alerts","Per-account rules","Per-service rules","Scheduled digest alerts"].map((f) => (
            <div key={f} className="flex items-center gap-2 text-xs font-semibold text-black">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-900 flex-shrink-0" />
              {f}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
