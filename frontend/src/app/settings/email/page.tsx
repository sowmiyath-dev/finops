"use client";
import { Mail, Clock } from "lucide-react";
export default function SettingsEmailPage() {
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Mail className="w-6 h-6 text-blue-900" />
        <div>
          <h1 className="text-2xl font-bold text-black">Email Configuration</h1>
          <p className="text-sm text-black mt-0.5">Configure SMTP settings and email notification templates</p>
        </div>
      </div>
      <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-16 text-center">
        <Clock className="w-12 h-12 text-blue-900 mx-auto mb-4" />
        <h2 className="text-lg font-bold text-black mb-2">Coming Soon</h2>
        <p className="text-sm text-black max-w-md mx-auto mb-6">
          Configure SMTP server settings and customize email templates for cost alerts, weekly digests, and reports.
        </p>
        <div className="grid grid-cols-2 gap-3 max-w-sm mx-auto text-left">
          {["SMTP server config","Email templates","Alert email recipients","Weekly cost digest","Monthly report email","Custom branding"].map((f) => (
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
