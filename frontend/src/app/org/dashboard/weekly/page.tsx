"use client";
import { TrendingUp, Clock } from "lucide-react";
export default function WeeklyDashboard() {
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <TrendingUp className="w-6 h-6 text-blue-900" />
        <div>
          <h1 className="text-2xl font-bold text-black">Weekly Cost Dashboard</h1>
          <p className="text-sm text-black mt-0.5">Week-over-week cost trends across all clouds</p>
        </div>
      </div>
      <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-16 text-center">
        <Clock className="w-12 h-12 text-blue-900 mx-auto mb-4" />
        <h2 className="text-lg font-bold text-black mb-2">Coming Soon</h2>
        <p className="text-sm text-black max-w-md mx-auto">Weekly cost dashboard with WoW trends, anomaly detection and spend patterns will be available here.</p>
      </div>
    </div>
  );
}
