import { get, set, del, keys } from 'idb-keyval';
import type { MixSettings } from '@/hooks/useAudioMixer';

export type LineSync = { id: string; text: string; start: number | null; end: number | null; };

export interface SavedDraft {
  id: string;
  title: string;
  updatedAt: number;
  trackFile?: File;
  recordedBlob?: Blob;
  lyrics: LineSync[];
  mixSettings: MixSettings;
}

export interface DraftMetadata {
  id: string;
  title: string;
  updatedAt: number;
}

const DRAFTS_PREFIX = 'draft_';

export async function saveDraft(draft: SavedDraft): Promise<void> {
  const allKeys = await keys();
  const draftKeys = allKeys.filter(k => typeof k === 'string' && k.startsWith(DRAFTS_PREFIX));
  
  if (!draftKeys.includes(draft.id) && draftKeys.length >= 3) {
    throw new Error('LIMIT_REACHED');
  }

  await set(draft.id, draft);
}

export async function getDraftsList(): Promise<DraftMetadata[]> {
  const allKeys = await keys();
  const draftKeys = allKeys.filter(k => typeof k === 'string' && k.startsWith(DRAFTS_PREFIX));
  
  const draftsList: DraftMetadata[] = [];
  for (const key of draftKeys) {
    const draft = await get<SavedDraft>(key as string);
    if (draft) {
      draftsList.push({
        id: draft.id,
        title: draft.title,
        updatedAt: draft.updatedAt,
      });
    }
  }
  
  return draftsList.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadDraft(id: string): Promise<SavedDraft | undefined> {
  return await get<SavedDraft>(id);
}

export async function deleteDraft(id: string): Promise<void> {
  await del(id);
}
