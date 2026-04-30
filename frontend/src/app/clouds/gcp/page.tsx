"use client";
import { Globe } from "lucide-react";
export default function GCPPage() {
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Globe className="w-6 h-6" style={{ color: "#4285f4" }} />
        <div>
          <h1 className="text-2xl font-bold text-black">Google Cloud Platform</h1>
          <p className="text-sm text-black mt-0.5">GCP cost management and resource tracking</p>
        </div>
      </div>
      <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-16 text-center">
        <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: "#e8f0fe" }}>
          <Globe className="w-8 h-8" style={{ color: "#4285f4" }} />
        </div>
        <h2 className="text-lg font-bold text-black mb-2">GCP Integration — Coming Soon</h2>
        <p className="text-sm text-black max-w-md mx-auto mb-6">
          Connect your GCP projects to track costs, analyze spending by project, service, and labels. Full parity with AWS features.
        </p>
        <div className="grid grid-cols-3 gap-3 max-w-lg mx-auto text-left">
          {["Project cost tracking","Service breakdown","GCP labels support","Committed use discounts","Sustained use discounts","CSV export"].map((f) => (
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
