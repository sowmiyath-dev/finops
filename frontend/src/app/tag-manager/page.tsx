"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/authStore";
import api from "@/lib/api";
import toast from "react-hot-toast";
import { Tag, Plus, Trash2, Search, X, CheckSquare } from "lucide-react";

const TAG_COLORS = [
  "#0f2d5e","#1a6fa8","#ec7211","#1d8348","#c0392b",
  "#8e44ad","#2980b9","#16a085","#d68910","#7f8c8d",
];

export default function TagManagerPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newTag, setNewTag] = useState({ tag_key: "", tag_value: "", color: "#0f2d5e", description: "" });
  const [search, setSearch] = useState("");
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [resourceIds, setResourceIds] = useState("");
  const [assignService, setAssignService] = useState("");
  const [assignAccount, setAssignAccount] = useState("");

  const { data: tags = [], isLoading } = useQuery({
    queryKey: ["custom-tags-summary"],
    queryFn: () => api.get("/tags/summary").then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post("/tags/", newTag),
    onSuccess: () => {
      toast.success("Tag created");
      qc.invalidateQueries({ queryKey: ["custom-tags-summary"] });
      setShowCreate(false);
      setNewTag({ tag_key: "", tag_value: "", color: "#0f2d5e", description: "" });
    },
    onError: (err: any) => toast.error(err.response?.data?.detail || "Failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/tags/${id}`),
    onSuccess: () => { toast.success("Tag deleted"); qc.invalidateQueries({ queryKey: ["custom-tags-summary"] }); },
  });

  const assignMutation = useMutation({
    mutationFn: () => api.post("/tags/assign", {
      resource_ids: resourceIds.split("\n").map((r) => r.trim()).filter(Boolean),
      custom_tag_ids: [selectedTagId],
      cloud_provider: "aws",
      aws_account_id: assignAccount || null,
      service: assignService || null,
    }),
    onSuccess: (data: any) => {
      toast.success(`Assigned tag to ${data.data.assigned} resources`);
      qc.invalidateQueries({ queryKey: ["custom-tags-summary"] });
      setResourceIds("");
      setSelectedTagId(null);
    },
    onError: (err: any) => toast.error(err.response?.data?.detail || "Failed"),
  });

  const filtered = tags.filter((t: any) =>
    !search ||
    t.tag_key.toLowerCase().includes(search.toLowerCase()) ||
    t.tag_value.toLowerCase().includes(search.toLowerCase())
  );

  const inputCls = "w-full border border-gray-400 rounded-md px-3 py-2 text-sm text-black bg-white focus:outline-none focus:border-blue-900";

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Tag className="w-6 h-6 text-blue-900" />
          <div>
            <h1 className="text-2xl font-bold text-black">Tag Manager</h1>
            <p className="text-sm text-black mt-0.5">Create and assign custom application-level tags to resources</p>
          </div>
        </div>
        {(user?.role === "owner" || user?.role === "editor") && (
          <button onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white bg-blue-900 hover:bg-blue-800 rounded-md transition">
            <Plus className="w-4 h-4" /> Create Tag
          </button>
        )}
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-2 mb-5 px-4 py-3 rounded-lg border border-blue-300 bg-blue-50 text-blue-900 text-sm font-semibold">
        <Tag className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          Custom tags are <strong>application-level</strong> — they are stored in Finoptix and not pushed to AWS/Azure/GCP.
          Use them to group resources by Project, Owner, Team, or any custom dimension for cost filtering.
        </span>
      </div>

      {/* Create tag form */}
      {showCreate && (
        <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-6 mb-5">
          <h3 className="text-sm font-bold text-black mb-4">Create New Tag</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-black mb-1.5">Tag Key</label>
              <input value={newTag.tag_key} onChange={(e) => setNewTag({ ...newTag, tag_key: e.target.value })}
                className={inputCls} placeholder="e.g. Project, Owner, Team, Environment" />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-black mb-1.5">Tag Value</label>
              <input value={newTag.tag_value} onChange={(e) => setNewTag({ ...newTag, tag_value: e.target.value })}
                className={inputCls} placeholder="e.g. Samil, John, DevOps, Production" />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-black mb-1.5">Description (optional)</label>
              <input value={newTag.description} onChange={(e) => setNewTag({ ...newTag, description: e.target.value })}
                className={inputCls} placeholder="Brief description of this tag" />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wide text-black mb-1.5">Color</label>
              <div className="flex items-center gap-2">
                {TAG_COLORS.map((c) => (
                  <button key={c} onClick={() => setNewTag({ ...newTag, color: c })}
                    className={`w-6 h-6 rounded-full border-2 transition ${newTag.color === c ? "border-black scale-110" : "border-transparent"}`}
                    style={{ background: c }} />
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button onClick={() => createMutation.mutate()}
              className="px-4 py-2 text-sm font-bold text-white bg-blue-900 hover:bg-blue-800 rounded-md transition">
              Create Tag
            </button>
            <button onClick={() => setShowCreate(false)}
              className="px-4 py-2 text-sm font-bold text-black border border-gray-400 hover:bg-gray-100 rounded-md transition">
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Tags list */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg border border-gray-300 shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-gray-100 border-b-2 border-gray-300 flex items-center justify-between">
              <span className="text-sm font-bold text-black">Custom Tags ({filtered.length})</span>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-black" />
                <input value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search tags..."
                  className="pl-8 pr-3 py-1.5 border border-gray-400 rounded-md text-xs text-black bg-white focus:outline-none focus:border-blue-900 w-48" />
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center h-32">
                <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin border-blue-900" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-sm font-semibold text-black">
                No tags yet. Create your first tag to get started.
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-100 border-b-2 border-gray-300">
                    {["Tag", "Key : Value", "Resources", "Description", ""].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-bold uppercase tracking-wider text-black">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((tag: any) => (
                    <tr key={tag.id} className="border-b border-gray-200 hover:bg-blue-50 transition">
                      <td className="px-4 py-3">
                        <div className="w-4 h-4 rounded-full" style={{ background: tag.color }} />
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-bold px-2 py-1 rounded-full text-white" style={{ background: tag.color }}>
                          {tag.tag_key}: {tag.tag_value}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-bold text-black">{tag.resource_count}</td>
                      <td className="px-4 py-3 text-xs font-semibold text-black">{tag.description || "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => setSelectedTagId(tag.id === selectedTagId ? null : tag.id)}
                            className={`p-1.5 rounded transition text-xs font-bold ${selectedTagId === tag.id ? "bg-blue-900 text-white" : "text-black hover:bg-blue-100"}`}
                            title="Assign to resources">
                            <CheckSquare className="w-3.5 h-3.5" />
                          </button>
                          {(user?.role === "owner" || user?.role === "editor") && (
                            <button onClick={() => { if (confirm("Delete this tag?")) deleteMutation.mutate(tag.id); }}
                              className="p-1.5 rounded hover:bg-red-100 hover:text-red-700 transition text-black" title="Delete">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Assign panel */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-lg border border-gray-300 shadow-sm p-5">
            <h3 className="text-sm font-bold text-black mb-4 flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-blue-900" />
              Assign Tag to Resources
            </h3>

            {!selectedTagId ? (
              <p className="text-xs font-semibold text-black">
                Select a tag from the list (click the <CheckSquare className="w-3 h-3 inline" /> icon) to assign it to resources.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="px-3 py-2 rounded-lg border border-blue-300 bg-blue-50">
                  <p className="text-xs font-bold text-black">Selected tag:</p>
                  {(() => {
                    const t = tags.find((x: any) => x.id === selectedTagId);
                    return t ? (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white mt-1 inline-block" style={{ background: t.color }}>
                        {t.tag_key}: {t.tag_value}
                      </span>
                    ) : null;
                  })()}
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wide text-black mb-1.5">
                    Resource IDs (one per line)
                  </label>
                  <textarea
                    value={resourceIds}
                    onChange={(e) => setResourceIds(e.target.value)}
                    rows={5}
                    className="w-full border border-gray-400 rounded-md px-3 py-2 text-xs text-black bg-white focus:outline-none focus:border-blue-900 font-mono"
                    placeholder={"i-0abc123def456\narn:aws:s3:::my-bucket\ni-0xyz789..."} />
                  <p className="text-xs text-black mt-1">Supports bulk assignment — paste multiple resource IDs</p>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wide text-black mb-1.5">Service (optional)</label>
                  <input value={assignService} onChange={(e) => setAssignService(e.target.value)}
                    className={inputCls} placeholder="e.g. AmazonEC2" />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wide text-black mb-1.5">Account ID (optional)</label>
                  <input value={assignAccount} onChange={(e) => setAssignAccount(e.target.value)}
                    className={inputCls} placeholder="e.g. 838422312895" />
                </div>

                <div className="flex gap-2">
                  <button onClick={() => assignMutation.mutate()}
                    disabled={!resourceIds.trim()}
                    className="flex-1 py-2 text-sm font-bold text-white bg-blue-900 hover:bg-blue-800 rounded-md transition disabled:opacity-40">
                    Assign Tag
                  </button>
                  <button onClick={() => { setSelectedTagId(null); setResourceIds(""); }}
                    className="p-2 border border-gray-400 rounded-md hover:bg-gray-100 transition text-black">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
