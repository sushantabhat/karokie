import React, { useEffect, useState } from 'react';
import { getDraftsList, deleteDraft, DraftMetadata, SavedDraft, loadDraft } from '@/utils/db';
import { Trash2, FolderOpen, X } from 'lucide-react';

interface DraftsModalProps {
  onClose: () => void;
  onLoad: (draft: SavedDraft) => void;
}

export function DraftsModal({ onClose, onLoad }: DraftsModalProps) {
  const [drafts, setDrafts] = useState<DraftMetadata[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDrafts = async () => {
    setLoading(true);
    try {
      const list = await getDraftsList();
      setDrafts(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDrafts();
  }, []);

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this draft?')) {
      await deleteDraft(id);
      await fetchDrafts();
    }
  };

  const handleLoad = async (id: string) => {
    const draft = await loadDraft(id);
    if (draft) {
      onLoad(draft);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-panel border border-edge/20 light:border-edge rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-edge/20 light:border-edge">
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <FolderOpen className="w-5 h-5" />
            My Drafts
          </h2>
          <button onClick={onClose} className="text-muted hover:text-foreground transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-medium text-secondary">Storage Usage</span>
            <span className="text-sm font-bold text-foreground">{drafts.length} / 3 Slots Used</span>
          </div>
          
          <div className="w-full bg-control rounded-full h-2 mb-6 overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all ${drafts.length === 3 ? 'bg-red-500' : 'bg-[#1db954]'}`} 
              style={{ width: `${(drafts.length / 3) * 100}%` }} 
            />
          </div>

          <div className="space-y-3">
            {loading ? (
              <div className="text-center text-secondary py-4">Loading drafts...</div>
            ) : drafts.length === 0 ? (
              <div className="text-center text-secondary py-8 border border-dashed border-edge/20 light:border-edge rounded-xl">
                No saved drafts yet.
              </div>
            ) : (
              drafts.map(draft => (
                <div key={draft.id} className="flex items-center justify-between p-4 bg-control/50 rounded-xl border border-edge/20 light:border-edge hover:border-edge/40 transition-colors">
                  <div className="flex flex-col min-w-0 pr-4">
                    <span className="font-bold text-foreground truncate">{draft.title}</span>
                    <span className="text-xs text-secondary">
                      {new Date(draft.updatedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button 
                      onClick={() => handleLoad(draft.id)}
                      className="px-4 py-2 bg-foreground text-background text-xs font-bold rounded-full hover:opacity-90 transition-colors"
                    >
                      Load
                    </button>
                    <button 
                      onClick={() => handleDelete(draft.id)}
                      className="p-2 text-red-500 hover:bg-red-500/10 rounded-full transition-colors"
                      title="Delete Draft"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
