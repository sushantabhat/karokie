'use client';

import { useState, useRef, useEffect } from 'react';
import WaveformEditor from "./WaveformEditor";
import { DraftsModal } from "./DraftsModal";
import { saveDraft, SavedDraft } from "@/utils/db";


import { Upload, Headphones, Mic, Play, Pause, Square, Settings2, Download, CheckCircle2, Volume2, Mic2, RotateCcw, Target, Plus, Minus, Save, FolderOpen, Trash2 } from 'lucide-react';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useAudioMixer, MixSettings } from '@/hooks/useAudioMixer';
import { saveTrackToDB, getTrackFromDB, saveVocalToDB, getVocalFromDB } from '@/utils/indexedDB';
import { audioBufferToWav } from '@/utils/audioBufferToWav';

function StaticWaveform({ buffer, color, duration, currentTime, totalDuration, onSeekStart, onSeekDrag, onSeekEnd, emptyText = "No Audio Data" }: { buffer: AudioBuffer | null, color: string | string[], duration: number, currentTime: number, totalDuration?: number, onSeekStart?: (time: number) => void, onSeekDrag?: (time: number) => void, onSeekEnd?: (time: number) => void, emptyText?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  
  const [isDraggingState, setIsDraggingState] = useState(false);

  useEffect(() => {
    if (!canvasRef.current || !buffer) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Scale for high DPI displays if needed (keeping it simple for now)
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const data = buffer.getChannelData(0);
    const actualTotalDuration = totalDuration || buffer.duration;
    const widthProportion = Math.min(buffer.duration / actualTotalDuration, 1.0);
    const targetWidth = canvas.width * widthProportion;
    
    const step = Math.ceil(data.length / targetWidth);
    
    let fillStyle: string | CanvasGradient = '';
    if (Array.isArray(color)) {
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, color[0]);
      gradient.addColorStop(1, color[1] || color[0]);
      fillStyle = gradient;
    } else {
      fillStyle = color;
    }
    
    ctx.fillStyle = fillStyle;
    
    // Glowing neon effect for waveform
    ctx.shadowBlur = 10;
    ctx.shadowColor = Array.isArray(color) ? color[0] : color;

    for (let i = 0; i < targetWidth; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) {
        const index = (i * step) + j;
        if (index < data.length) {
          sum += Math.abs(data[index]);
        }
      }
      
      const average = sum / step;
      // Multiply by a factor to make the waveform look full but dynamic
      const scaledHeight = Math.min(1.0, average * 3.5) * canvas.height;
      const height = Math.max(1, scaledHeight);
      const y = (canvas.height - height) / 2;
      
      ctx.fillRect(i, y, 1, height);
    }
  }, [buffer, color, totalDuration]);

  const actualTotalDuration = totalDuration || duration;
  const progress = actualTotalDuration > 0 ? (currentTime / actualTotalDuration) * 100 : 0;

  const calculateSeekTime = (clientX: number) => {
    if (!containerRef.current) return 0;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percentage = x / rect.width;
    return percentage * actualTotalDuration;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    isDragging.current = true;
    setIsDraggingState(true);
    if (onSeekStart) onSeekStart(calculateSeekTime(e.clientX));
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging.current && onSeekDrag) {
      onSeekDrag(calculateSeekTime(e.clientX));
    }
  };

  useEffect(() => {
    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (isDragging.current) {
        isDragging.current = false;
        setIsDraggingState(false);
        if (onSeekEnd) onSeekEnd(calculateSeekTime(e.clientX));
      }
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSeekEnd, actualTotalDuration]);

  return (
    <div 
      ref={containerRef}
      className={`relative w-full h-full bg-[#121214] ${onSeekStart ? 'cursor-pointer select-none' : ''}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
    >
      {buffer ? (
        <canvas ref={canvasRef} className="w-full h-full opacity-50 pointer-events-none" />
      ) : (
        <div className="w-full h-full flex items-center justify-center pointer-events-none">
          <span className="text-[#424754] text-xs font-mono">{emptyText}</span>
        </div>
      )}
      <div 
        className="absolute top-0 bottom-0 w-[2px] bg-[#3b82f6] z-10 shadow-[0_0_8px_rgba(59,130,246,0.8)] pointer-events-none"
        style={{ left: `${Math.min(progress, 100)}%`, transition: isDraggingState ? 'none' : 'left 0.1s linear' }}
      />
    </div>
  );
}

// ==== Auto-Save (localStorage) helpers ====
// Key for the index that tracks recent saved tracks (max 10)
const AUTOSAVE_INDEX_KEY = 'lyricsAutosaveIndex';
const AUTOSAVE_MAX = 10;

// Compute SHA-256 hash of a File (hex string)
const hashFile = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

export type LineSync = { id: string; text: string; start: number | null; end: number | null; };

const loadLyricsFromLocalStorage = (hash: string) => {
  const data = localStorage.getItem(`lyrics-autosave-${hash}`);
  if (!data) return null;
  try {
    const parsed = JSON.parse(data);
    if (parsed && parsed.length > 0 && !parsed[0].id) {
      localStorage.removeItem(`lyrics-autosave-${hash}`);
      return null;
    }
    return parsed;
  } catch {
    // Corrupt entry - clean it up
    localStorage.removeItem(`lyrics-autosave-${hash}`);
    return null;
  }
};

const saveLyricsToLocalStorage = (hash: string, ly: LineSync[]) => {
  localStorage.setItem(`lyrics-autosave-${hash}`, JSON.stringify(ly));
  // Update the LRU index
  const indexRaw = localStorage.getItem(AUTOSAVE_INDEX_KEY);
  const index: string[] = indexRaw ? JSON.parse(indexRaw) : [];
  const existingPos = index.indexOf(hash);
  if (existingPos !== -1) index.splice(existingPos, 1);
  index.unshift(hash); // most recent at front
  if (index.length > AUTOSAVE_MAX) {
    const evicted = index.pop();
    if (evicted) localStorage.removeItem(`lyrics-autosave-${evicted}`);
  }
  localStorage.setItem(AUTOSAVE_INDEX_KEY, JSON.stringify(index));
};

export default function KaraokeStudio() {
  const [trackFile, setTrackFile] = useState<File | null>(null);
  const [trackUrl, setTrackUrl] = useState<string | null>(null);
  const [headphonesConfirmed, setHeadphonesConfirmed] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  
  const { 
    isRecording, isPaused: isRecPaused, 
    recordedBlob, setRecordedBlob, startRecording, stopRecording, pauseRecording, resumeRecording, resetRecording, getAnalyser 
  } = useAudioRecorder();

  const { 
    loadTrack, loadVocal, mergeVocal, clearVocal, clearTrack, playPreview, stopPreview, exportMix,
    isPlaying, isProcessing, setTrackVolumeLive, setVocalVolumeLive,
    trackBuffer, vocalBuffer 
  } = useAudioMixer();

  type Tab = "MIXER" | "SYNC" | "EDIT";
  const [activeTab, setActiveTab] = useState<Tab>("MIXER");
  const [activeLineIndex, setActiveLineIndex] = useState(0);
  const [isSpacebarDown, setIsSpacebarDown] = useState(false);
  const [isSyncSessionActive, setIsSyncSessionActive] = useState(false);

  const [rawLyricsText, setRawLyricsText] = useState("");
  const [lyrics, setLyrics] = useState<LineSync[]>([]);
  const [activeWordIndex, setActiveWordIndex] = useState(0);
  const [isPainting, setIsPainting] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const punchInTimeRef = useRef<number>(0);
  const previewStartTimeRef = useRef<number>(0);
  const previewStartOffsetRef = useRef<number>(0);

  const [mixSettings, setMixSettings] = useState<MixSettings>({
    trackVolume: 80,
    vocalVolume: 100,
    latencyOffsetMs: 0,
    reverbEnabled: false,
  });

  // ==== UI state ====
  const [, setAutoSaved] = useState(false);
  const [trackHash, setTrackHash] = useState<string | null>(null);

  // Auto-save lyrics whenever they change
  useEffect(() => {
    if (trackHash) {
      saveLyricsToLocalStorage(trackHash, lyrics);
    }
  }, [lyrics, trackHash]);

  // Restore session from IndexedDB on mount
  useEffect(() => {
    async function restoreSession() {
      try {
        const savedTrack = await getTrackFromDB();
        if (savedTrack && savedTrack.file) {
          setTrackFile(savedTrack.file);
          const url = URL.createObjectURL(savedTrack.file);
          setTrackUrl(url);
          setTrackHash(savedTrack.hash);
          
          const saved = loadLyricsFromLocalStorage(savedTrack.hash);
          if (saved) {
            setLyrics(saved);
            setAutoSaved(true);
            setTimeout(() => setAutoSaved(false), 3000);
          }
          await loadTrack(savedTrack.file);
        }

        const savedVocal = await getVocalFromDB();
        if (savedVocal) {
          loadVocal(savedVocal);
        }

        const savedTime = localStorage.getItem('playbackTime');
        if (savedTime) {
          setCurrentTime(parseFloat(savedTime));
        }
      } catch (err) {
        console.error("Failed to restore session from DB", err);
      }
    }
    restoreSession();
  }, [loadTrack, loadVocal]);

  // Auto-save playback time
  useEffect(() => {
    localStorage.setItem('playbackTime', currentTime.toString());
  }, [currentTime]);

  // Auto-save vocal buffer when it changes
  useEffect(() => {
    if (vocalBuffer) {
      const blob = audioBufferToWav(vocalBuffer);
      saveVocalToDB(blob).catch(console.error);
    }
  }, [vocalBuffer]);

  // ==== Export .LRC ====
  const formatLRC = () => {
    return lyrics
      .filter(l => l.start !== null)
      .map(l => {
        const t = l.start!;
        const mins = Math.floor(t / 60);
        const secs = (t % 60).toFixed(2).padStart(5, '0');
        return `[${mins}:${secs}] ${l.text}`;
      })
      .join('\n');
  };

  const handleExportLRC = () => {
    const lrc = formatLRC();
    const blob = new Blob([lrc], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const baseName = trackFile?.name.replace(/\.mp3$/i, '') || 'lyrics';
    a.download = `${baseName}.lrc`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateSetting = (key: keyof MixSettings, value: any) => {
    setMixSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleTrackUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setTrackFile(file);
      const url = URL.createObjectURL(file);
      setTrackUrl(url);
      // Compute hash, load any saved lyrics, and set toast flag
      const hash = await hashFile(file);
      setTrackHash(hash);
      const saved = loadLyricsFromLocalStorage(hash);
      if (saved) {
        setLyrics(saved);
        setAutoSaved(true);
        setTimeout(() => setAutoSaved(false), 3000);
      }
      
      // Save track to IndexedDB to survive refresh
      await saveTrackToDB({ file, hash, name: file.name });
      
      await loadTrack(file);
    }
  };
  // Handle LRC file upload and parsing
  const handleLRCUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        let absIdx = 0;
        const text = ev.target?.result as string;
        const parsed = text
          .split('\n')
          .map((line) => {
            const match = line.match(/\[(\d+):(\d{2}\.\d{2})\](.*)/);
            if (match) {
              const mins = parseInt(match[1], 10);
              const secs = parseFloat(match[2]);
              const time = mins * 60 + secs;
              const txt = match[3].trim();
              const words = txt.split(/\s+/).filter(w => w).map(w => ({ text: w, start: null, end: null, absoluteIdx: absIdx++ }));
              return { id: "line-" + Date.now() + "-" + Math.random(), text: txt, start: time, end: null } as LineSync;
            }
            const txt = line.trim();
            if (txt) {
               const words = txt.split(/\s+/).filter(w => w).map(w => ({ text: w, start: null, end: null, absoluteIdx: absIdx++ }));
               return { id: "line-" + Date.now() + "-" + Math.random(), text: txt, start: null, end: null } as LineSync;
            }
            return null;
          })
          .filter((l): l is LineSync => l !== null && l.text !== '');
        setLyrics(parsed);
        // Show a toast indicating LRC loaded
        setAutoSaved(true);
        setTimeout(() => setAutoSaved(false), 3000);
      };
      reader.readAsText(file);
    }
  };
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  const handleStartRecording = async () => {
    if (!headphonesConfirmed) {
      const confirmed = window.confirm("Please wear headphones to prevent audio feedback (echo) from your speakers. Click OK when you are ready.");
      if (!confirmed) return;
      setHeadphonesConfirmed(true);
    }

    if (vocalBuffer) {
      const continueTake = window.confirm("Click OK to seamlessly continue recording from the exact end of your last take.\n\nClick Cancel to wipe the track and start a fresh take from the beginning.");
      if (continueTake) {
        punchInTimeRef.current = vocalBuffer.duration;
        setCurrentTime(vocalBuffer.duration);
      } else {
        clearVocal();
        punchInTimeRef.current = 0;
        setCurrentTime(0);
      }
    } else {
      punchInTimeRef.current = currentTime;
    }

    stopPreview();
    resetRecording();
    await startRecording();
    
    if (audioRef.current) {
      audioRef.current.volume = Math.min(mixSettings.trackVolume / 100, 1);
      audioRef.current.currentTime = punchInTimeRef.current;
      audioRef.current.play();
    }
  };

  const handleStopRecording = () => {
    stopRecording();
    if (audioRef.current) {
      audioRef.current.pause();
    }
  };

  const handlePauseResumeRecording = () => {
    if (isRecPaused) {
      resumeRecording();
      if (audioRef.current) audioRef.current.play();
    } else {
      pauseRecording();
      if (audioRef.current) audioRef.current.pause();
    }
  };

  // Time tracker for UI
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording && !isRecPaused) {
      interval = setInterval(() => {
        if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
      }, 100);
    } else if (isPlaying) {
      interval = setInterval(() => {
        const elapsed = (performance.now() - previewStartTimeRef.current) / 1000;
        const nextTime = previewStartOffsetRef.current + elapsed;
        
        setCurrentTime(nextTime);
        
        // Auto-stop when reviewing synced lyrics in SYNC tab
        setLyrics(currentLyrics => {
            if (activeTab === "SYNC" && !isSyncSessionActive && currentLyrics.length > 0) {
              let lastSyncedLyric = null;
              for (let i = currentLyrics.length - 1; i >= 0; i--) {
                if (currentLyrics[i].start !== null) {
                  lastSyncedLyric = currentLyrics[i];
                  break;
                }
              }
              
              if (lastSyncedLyric) {
                const stopTime = lastSyncedLyric.end !== null ? lastSyncedLyric.end + 1.0 : lastSyncedLyric.start! + 4.0;
                if (nextTime >= stopTime) {
                  setTimeout(() => {
                    stopPreview();
                    if (audioRef.current) audioRef.current.currentTime = 0;
                  }, 0);
                }
              }
            }
            return currentLyrics;
          });
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isRecording, isRecPaused, isPlaying, isSyncSessionActive, activeTab, stopPreview]); 

  // Visualizer loop
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const analyser = getAnalyser();
    if (!isRecording || isRecPaused || !analyser) {
      ctx.fillStyle = '#121214';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = '#424754';
      ctx.beginPath();
      ctx.moveTo(0, canvas.height / 2);
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
      return;
    }

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let animationId: number;

    const draw = () => {
      animationId = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      ctx.fillStyle = '#121214';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = 2;
      ctx.strokeStyle = '#3b82f6';
      ctx.beginPath();

      const sliceWidth = canvas.width * 1.0 / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * canvas.height / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };

    draw();
    return () => cancelAnimationFrame(animationId);
  }, [isRecording, isRecPaused, getAnalyser]);

  // Reset time when stopping
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isRecording && !isPlaying) setCurrentTime(0);
  }, [isRecording, isPlaying]);


  useEffect(() => {
    if (recordedBlob) {
      if (punchInTimeRef.current > 0 && vocalBuffer) {
        mergeVocal(recordedBlob, punchInTimeRef.current);
      } else {
        loadVocal(recordedBlob);
      }
    }
  }, [recordedBlob, loadVocal, mergeVocal, clearVocal, clearTrack, vocalBuffer]);

  const [trackMuted, setTrackMuted] = useState(false);
  const [vocalMuted, setVocalMuted] = useState(false);
  const [showFullLyrics, setShowFullLyrics] = useState(false);
  
  const [showDraftsModal, setShowDraftsModal] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  const handleSaveDraftClick = async () => {
    if (!trackFile) return;
    
    const defaultTitle = trackFile.name.replace(/\.[^/.]+$/, "") || "Untitled Project";
    const userTitle = window.prompt("Enter a name for this draft:", defaultTitle);
    
    if (userTitle === null) return; // User cancelled
    
    setIsSavingDraft(true);
    try {
      const draftId = `draft_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const finalTitle = userTitle.trim() || defaultTitle;
      
      await saveDraft({
        id: draftId,
        title: finalTitle,
        updatedAt: Date.now(),
        trackFile,
        recordedBlob: recordedBlob || undefined,
        lyrics,
        mixSettings
      });
      alert('Draft saved successfully!');
    } catch (e: any) {
      if (e.message === 'LIMIT_REACHED') {
        alert('You have reached the limit of 3 drafts. Please delete an old draft first.');
        setShowDraftsModal(true);
      } else {
        alert('Failed to save draft. Try again.');
        console.error(e);
      }
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleNewSession = () => {
    if (confirm("Are you sure you want to start over? Unsaved progress will be lost.")) {
      if (isPlaying) handleStopClick();
      setTrackFile(null);
      setTrackUrl(null);
      clearTrack(); // useAudioMixer will handle null or we can just ignore since UI will block play
      setRecordedBlob(null);
      clearVocal();
      setLyrics([]);
      setRawLyricsText("");
      setCurrentTime(0);
      setIsSyncSessionActive(false);
    }
  };

  const handleLoadDraft = (draft: SavedDraft) => {
    if (isPlaying) handleStopClick();
    if (draft.trackFile) {
      setTrackFile(draft.trackFile);
      setTrackUrl(URL.createObjectURL(draft.trackFile));
      loadTrack(draft.trackFile);
    }
    
    if (draft.recordedBlob) {
      setRecordedBlob(draft.recordedBlob);
    } else {
      setRecordedBlob(null);
      clearVocal();
    }
    
    setLyrics(draft.lyrics);
    setMixSettings(draft.mixSettings);
    setActiveTab('MIXER');
  };

  // Mute Logic
  const effectiveTrackVolume = trackMuted ? 0 : mixSettings.trackVolume;
  const effectiveVocalVolume = vocalMuted || (activeTab === 'SYNC' || activeTab === 'EDIT') ? 0 : mixSettings.vocalVolume;

  // Apply live volume changes when Mute state changes
  useEffect(() => {
    if (isPlaying) {
      setTrackVolumeLive(effectiveTrackVolume);
      setVocalVolumeLive(effectiveVocalVolume);
    }
  }, [trackMuted, vocalMuted, isPlaying, effectiveTrackVolume, effectiveVocalVolume, setTrackVolumeLive, setVocalVolumeLive]);

  const masterDuration = Math.max(trackBuffer?.duration || 0, vocalBuffer?.duration || 0);

  const wasPlayingBeforeDrag = useRef(false);

  const handleSeekStart = (time: number) => {
    if (isRecording) return;
    setCurrentTime(time);
    
    wasPlayingBeforeDrag.current = isPlaying;
    if (isPlaying) {
      stopPreview(); // Stop audio immediately so dragging is silent and safe
    }
  };

  const handleSeekDrag = (time: number) => {
    if (isRecording) return;
    setCurrentTime(time);
  };

  const startPlayback = (timeOffset: number) => {
    previewStartTimeRef.current = performance.now();
    previewStartOffsetRef.current = timeOffset;
    playPreview({
      ...mixSettings,
      trackVolume: effectiveTrackVolume,
      vocalVolume: effectiveVocalVolume
    }, timeOffset);
  };

  const handleSeekEnd = (time: number) => {
    if (isRecording) return;
    setCurrentTime(time);
    
    if (wasPlayingBeforeDrag.current) {
      startPlayback(time);
    }
  };

  const handlePlayPreviewClick = () => {
    if (isPlaying) {
      stopPreview();
    } else {
      startPlayback(currentTime);
    }
  };

  const handleExportClick = () => {
    exportMix({
      ...mixSettings,
      trackVolume: effectiveTrackVolume,
      vocalVolume: effectiveVocalVolume
    }).then(blob => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = 'karaoke_mix.wav';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
      }
    });
  };

  const handleStopClick = () => {
    if (isRecording) handleStopRecording();
    if (isPlaying) stopPreview();
    setCurrentTime(0); // Reset playhead when stopped
    setIsSyncSessionActive(false); // Gracefully exit sync mode on hard stop
  };

  const handlePlayPauseClick = () => {
    if (isRecording) {
      handlePauseResumeRecording();
    } else if (isPlaying) {
      stopPreview();
    } else {
      handlePlayPreviewClick();
    }
  };

  const handleLineUpdate = (id: string, newStart: number | null, newEnd: number | null) => {
    setLyrics(prev => {
      const next = [...prev];
      const idx = next.findIndex(l => l.id === id);
      if (idx === -1) return prev;

      if (newStart === null || newEnd === null) {
        next[idx] = { ...next[idx], start: null, end: null };
        return next;
      }

      let adjustedStart = newStart;
      let adjustedEnd = newEnd;
      
      let prevStart = null;
      let nextStart = null;
      let prevIdx = -1;
      
      // Find the closest placed line BEFORE this one
      for (let i = idx - 1; i >= 0; i--) {
        if (next[i].start !== null) {
          prevStart = next[i].start as number;
          prevIdx = i;
          break;
        }
      }
      
      // Find the closest placed line AFTER this one
      for (let i = idx + 1; i < next.length; i++) {
        if (next[i].start !== null) {
          nextStart = next[i].start as number;
          break;
        }
      }

      // 1. STRICT CHRONOLOGICAL CONSTRAINT: Cannot start before previous placed line
      if (prevStart !== null && adjustedStart <= prevStart) {
        adjustedStart = prevStart + 0.1;
      }

      // 2. STRICT CHRONOLOGICAL CONSTRAINT: Cannot start after next placed line
      if (nextStart !== null && adjustedStart >= nextStart) {
        adjustedStart = nextStart - 0.2;
      }

      // 3. Prevent inversion and maintain minimum duration
      if (adjustedStart >= adjustedEnd - 0.1) {
        adjustedEnd = adjustedStart + 0.1;
      }

      // 4. PREVENT OVERLAP (Optional but clean): 
      if (nextStart !== null && adjustedEnd > nextStart) {
        adjustedEnd = nextStart;
        if (adjustedStart >= adjustedEnd - 0.1) {
           adjustedStart = adjustedEnd - 0.1;
        }
      }

      // 5. Do not let this line's start bleed before the closest previous line's end
      if (prevIdx >= 0 && next[prevIdx].end !== null) {
        const prevEnd = next[prevIdx].end as number;
        if (adjustedStart < prevEnd) {
           // Push the previous line's end back to make room
           next[prevIdx] = { ...next[prevIdx], end: adjustedStart };
        }
      }

      next[idx] = { ...next[idx], start: adjustedStart, end: adjustedEnd };

      return next;
    });
  };

  const triggerSyncTap = () => {
    setIsSpacebarDown(true);
    setTimeout(() => setIsSpacebarDown(false), 150);
    
    setLyrics(prev => {
       const next = [...prev];
       const currIdx = activeLineIndex;
       
       if (currIdx < next.length) {
          next[currIdx] = { ...next[currIdx], start: currentTime };
       }
       if (currIdx > 0 && currIdx <= next.length) {
          next[currIdx - 1] = { ...next[currIdx - 1], end: currentTime };
       }
       return next;
    });
    
    if (activeLineIndex <= lyrics.length) {
      setActiveLineIndex(idx => idx + 1);
    }
  };

  // Spacebar Logic (Tap to advance)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Allow spacebar if not typing in an input
      if (e.code === "Space" && e.target instanceof Element && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA" && activeTab === "SYNC") {
        e.preventDefault();
        if (e.repeat) return;
        if (isSyncSessionActive && isPlaying) {
          triggerSyncTap();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeLineIndex, activeTab, currentTime, lyrics.length, isSyncSessionActive, isPlaying]);

  const hasSyncedLines = lyrics.some(l => l.start !== null);

  return (
    <>
      {showDraftsModal && <DraftsModal onClose={() => setShowDraftsModal(false)} onLoad={handleLoadDraft} />}
      <div className="h-screen flex flex-col bg-[#0B0E14] text-[#fafafa] font-sans relative overflow-hidden">

      {/* HEADER */}
      <header className="h-16 shrink-0 flex items-center justify-between border-b border-white/10 bg-[#161B22] px-8 shadow-sm z-10">
        
        {/* LEFT SIDE: Brand & Tabs */}
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-black tracking-tighter text-white flex items-center gap-2">
            <Mic2 className="w-5 h-5 text-white" />
            KARAOKE STUDIO
          </h1>
          
          <div className="h-6 w-px bg-[#1f222b]" />
          
          {/* VIEW TOGGLE */}
          <div className="flex bg-white/5 p-1 rounded-full border border-white/5">
            <button onClick={() => setActiveTab("MIXER")} className={`px-5 py-1.5 rounded-full text-xs font-medium transition-all ${activeTab === "MIXER" ? "bg-white/10 text-white shadow-sm" : "text-[#a1a1aa] hover:text-[#fafafa]"}`}>Mixer</button>
            <button onClick={() => setActiveTab("SYNC")} className={`px-5 py-1.5 rounded-full text-xs font-medium transition-all ${activeTab === "SYNC" ? "bg-white/10 text-white shadow-sm" : "text-[#a1a1aa] hover:text-[#fafafa]"}`}>Sync</button>
            <button onClick={() => setActiveTab("EDIT")} className={`px-5 py-1.5 rounded-full text-xs font-medium transition-all ${activeTab === "EDIT" ? "bg-white/10 text-white shadow-sm" : "text-[#a1a1aa] hover:text-[#fafafa]"}`}>Edit</button>
          </div>
        </div>

        {/* RIGHT SIDE: Transport & Actions */}
        <div className="flex items-center gap-6">
          {/* Transport Controls */}
          <div className="flex items-center gap-3 bg-transparent p-1.5 rounded-full border border-white/10">
            <button 
              onClick={handlePlayPauseClick} 
              disabled={isRecording || !trackBuffer}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                (isPlaying)
                  ? 'bg-[#10b981] text-white shadow-[0_0_10px_rgba(16,185,129,0.4)]'
                  : 'bg-[#1f222b] text-[#10b981] hover:bg-[#10b981] hover:text-white disabled:opacity-50 disabled:pointer-events-none'
              }`}
              title="Play/Pause"
            >
              {(isPlaying) ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-1" />}
            </button>

            <button 
              onClick={handleStartRecording}
              disabled={isRecording || isPlaying || !trackFile || activeTab === "SYNC"}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                isRecording 
                  ? 'bg-transparent border-2 border-[#ef4444] shadow-[0_0_15px_rgba(239,68,68,0.7)] animate-pulse' 
                  : 'bg-[#1f222b] text-[#ef4444] hover:bg-[#ef4444]/20 disabled:opacity-50 disabled:pointer-events-none'
              }`}
              title="Record"
            >
              <div className={`rounded-full transition-all ${isRecording ? 'w-3 h-3 bg-[#ef4444]' : 'w-3 h-3 bg-[#ef4444]'}`} />
            </button>

            <button 
              onClick={handleStopClick}
              disabled={!isRecording && !isPlaying && currentTime === 0}
              className="w-10 h-10 rounded-full bg-[#1f222b] text-[#a1a1aa] hover:bg-[#3f3f46] hover:text-white flex items-center justify-center transition-colors disabled:opacity-50 disabled:pointer-events-none"
              title="Stop"
            >
              <Square className="w-3 h-3 fill-current" />
            </button>
          </div>

            <button 
              onClick={handleNewSession}
              className="px-5 py-2 bg-transparent border border-red-500/30 text-red-500 hover:bg-red-500/10 rounded-full text-xs font-bold transition-all flex items-center gap-2"
              title="Clear all and start fresh"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Start Over
            </button>

          <div className="h-6 w-px bg-[#1f222b]" />

          {/* Action Buttons based on Tab */}
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setShowDraftsModal(true)}
              className="px-5 py-2 bg-transparent border border-[#1db954]/30 text-[#1db954] hover:bg-[#1db954]/10 rounded-full text-xs font-bold transition-all flex items-center gap-2"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              My Drafts
            </button>
            <button 
              onClick={handleSaveDraftClick}
              disabled={!trackFile || lyrics.length === 0}
              className="px-5 py-2 bg-transparent border border-white/20 text-white hover:bg-white/10 rounded-full text-xs font-medium transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
            >
              <Save className="w-3.5 h-3.5" />
              {isSavingDraft ? "Saving..." : "Save Draft"}
            </button>
            <div className="h-6 w-px bg-[#1f222b] mx-2" />

            {activeTab === "MIXER" && (
              <>
                <button
                  onClick={() => document.getElementById('file-upload')?.click()}
                  className="px-5 py-2 bg-white/5 hover:bg-white/10 text-white rounded-full text-xs font-medium transition-all disabled:opacity-50 disabled:pointer-events-none"
                  title="Upload Instrumental"
                >
                  Upload Track
                </button>
                <button
                  onClick={handleExportClick}
                  disabled={isProcessing || !recordedBlob}
                  className="px-5 py-2 bg-white text-black hover:bg-gray-200 rounded-full text-xs font-medium transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
                >
                  {isProcessing ? 'Processing...' : 'Download Mix'}
                </button>
              </>
            )}
            
            {(activeTab === "SYNC" || activeTab === "EDIT") && (
              <>
                <button
                  onClick={() => document.getElementById('lrc-upload')?.click()}
                  className="px-5 py-2 bg-white/5 hover:bg-white/10 text-white rounded-full text-xs font-medium transition-all disabled:opacity-50 disabled:pointer-events-none"
                  title="Upload LRC"
                >
                  Upload .LRC
                </button>
                <button
                  onClick={handleExportLRC}
                  disabled={lyrics.length === 0 || !trackFile}
                  className="px-5 py-2 bg-white text-black hover:bg-gray-200 rounded-full text-xs font-medium transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
                >
                  Download .LRC
                </button>
              </>
            )}
          </div>
        </div>

        {/* Hidden file inputs */}
        <input type="file" accept="audio/*" className="hidden" id="file-upload" onChange={handleTrackUpload} />
        <input type="file" accept=".lrc" className="hidden" id="lrc-upload" onChange={handleLRCUpload} />
      </header>

      {/* TIMELINE AREA */}
      <div className={`flex-1 ${activeTab === 'MIXER' ? 'p-8 overflow-y-auto' : 'p-4 md:p-8 flex flex-col overflow-hidden min-h-0'}`}>
        {activeTab === 'MIXER' ? (
          <div className="max-w-6xl mx-auto space-y-6">
            
            {/* TELEPROMPTER */}
            {lyrics.some(l => l.start !== null) && (
              (() => {
                let currentIdx = -1;
                for (let i = lyrics.length - 1; i >= 0; i--) {
                  const lineStart = lyrics[i].start;
                  if (lineStart !== undefined && lineStart !== null && lineStart <= currentTime) {
                    currentIdx = i;
                    break;
                  }
                }
                const currentLine = currentIdx >= 0 ? lyrics[currentIdx] : null;
                const currentText = currentLine ? currentLine.text : "Get ready...";
                let nextText = "";
                for (let i = currentIdx + 1; i < lyrics.length; i++) {
                   if (lyrics[i].text.trim() !== "") {
                     nextText = lyrics[i].text;
                     break;
                   }
                }
                
                return (
                  <div className={`bg-[#161B22] border border-white/10 rounded-xl p-8 md:p-12 flex flex-col items-center justify-center shadow-sm relative overflow-hidden transition-all ${showFullLyrics ? 'h-[500px]' : 'min-h-[260px]'}`}>
                    <button 
                      onClick={() => setShowFullLyrics(!showFullLyrics)}
                      className="absolute top-4 right-4 z-20 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-[#a1a1aa] hover:text-white rounded-md text-xs font-medium transition-colors border border-white/5"
                    >
                      {showFullLyrics ? 'Collapse Lyrics' : 'View Full Lyrics'}
                    </button>
                    
                    {showFullLyrics ? (
                      <div className="w-full h-full overflow-y-auto custom-scrollbar px-4 py-8">
                        <div className="max-w-3xl mx-auto flex flex-col items-start">
                          {lyrics.map((line, idx) => {
                            const isCurrent = currentIdx === idx;
                            let progress = 0;
                            if (line.start !== null && currentTime >= line.start) {
                              if (isCurrent && line.end !== null) {
                                progress = Math.min(100, Math.max(0, ((currentTime - line.start) / (line.end - line.start)) * 100));
                              } else {
                                progress = 100;
                              }
                            }
                            
                            if (line.text.trim() === '') return <div key={line.id} className="h-4 w-full" />;
                            
                            return (
                              <div 
                                key={line.id} 
                                className={`mb-6 w-full ${isCurrent ? 'scale-105 origin-left' : 'opacity-70'} transition-all`}
                                ref={isCurrent ? (el) => el?.scrollIntoView({ behavior: 'smooth', block: 'center' }) : null}
                              >
                                <span 
                                  className="text-2xl md:text-3xl font-extrabold tracking-tight transition-all duration-75 block text-left"
                                  style={{ 
                                    backgroundImage: `linear-gradient(to right, #1db954 ${progress}%, #52525b ${progress}%)`,
                                    WebkitBackgroundClip: 'text',
                                    WebkitTextFillColor: 'transparent',
                                    filter: isCurrent && progress > 0 ? 'drop-shadow(0 0 10px rgba(29,185,84,0.3))' : 'none'
                                  }}
                                >
                                  {line.text}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap justify-center gap-x-2 z-10 w-full mt-4">
                          {currentLine ? (() => {
                            let progress = 0;
                            if (currentLine.start !== null && currentLine.end !== null && currentTime >= currentLine.start) {
                              if (currentTime >= currentLine.end) {
                                progress = 100;
                              } else {
                                progress = ((currentTime - currentLine.start) / (currentLine.end - currentLine.start)) * 100;
                              }
                            } else if (currentLine.start !== null && currentLine.end === null && currentTime >= currentLine.start) {
                              progress = 100;
                            }
                            
                            return (
                              <div className="relative inline-block text-center px-4 w-full">
                                <span 
                                  className="text-4xl md:text-5xl font-extrabold inline-block mx-1 leading-tight tracking-tight transition-all duration-75"
                                  style={{ 
                                    backgroundImage: `linear-gradient(to right, #1db954 ${progress}%, #52525b ${progress}%)`,
                                    WebkitBackgroundClip: 'text',
                                    WebkitTextFillColor: 'transparent',
                                    filter: progress > 0 ? 'drop-shadow(0 0 12px rgba(29,185,84,0.3))' : 'none'
                                  }}
                                >
                                  {currentLine.text}
                                </span>
                              </div>
                            );
                          })() : (
                            <span className="text-4xl md:text-5xl font-extrabold text-[#52525b] text-center tracking-tight">
                              {currentText}
                            </span>
                          )}
                        </div>
                        <span className="text-base md:text-lg font-medium text-[#71717a] text-center mt-6">
                          {nextText}
                        </span>
                      </>
                    )}
                  </div>
                );
              })()
            )}

          {/* TRACK 1: BACKING TRACK */}
          <div className="flex h-36 border border-white/10 bg-[#161B22] rounded-xl overflow-hidden shadow-sm">
            <div className="w-72 p-5 flex flex-col justify-between border-r border-white/10 shrink-0 bg-[#161B22]">
              <div className="flex-1">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2 overflow-hidden pr-2">
                    <span className="font-bold text-sm text-white truncate">🎵 Instrumental Track</span>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button 
                      onClick={() => {
                         if(confirm("Remove instrumental track?")) {
                            if (isPlaying) handleStopClick();
                            setTrackFile(null);
                            setTrackUrl(null);
                            clearTrack();
                         }
                      }}
                      className="w-6 h-6 rounded-xl border border-transparent text-[#71717a] hover:text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors flex items-center justify-center"
                      title="Remove Track"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    {trackBuffer && (
                      <button 
                        onClick={handlePlayPauseClick} 
                        className={`w-6 h-6 rounded-xl border flex items-center justify-center transition-all ${
                          (isPlaying) || (isRecording && !isRecPaused)
                            ? 'bg-[#10b981] border-[#10b981] text-white shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                            : 'bg-transparent border-[#10b981] text-[#10b981] hover:bg-[#10b981] hover:text-white'
                        }`}
                        title="Play/Pause Mix"
                      >
                        {(isPlaying) || (isRecording && !isRecPaused) ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current ml-0.5" />}
                      </button>
                    )}
                    <button 
                      onClick={() => setTrackMuted(!trackMuted)}
                      className={`w-6 h-6 rounded-xl border text-[10px] font-bold transition-all ${trackMuted ? 'bg-white border-[#38bdf8] text-black' : 'bg-transparent border-[#3f3f46] text-[#a1a1aa] hover:border-[#38bdf8] hover:text-white'}`}
                    >
                      M
                    </button>
                  </div>
                </div>
                {trackFile && <span className="text-xs text-[#71717a] font-medium truncate block">{trackFile.name}</span>}
                {trackBuffer && <span className="text-[11px] font-mono text-white mt-1.5 inline-block">{formatTime(currentTime)} / {formatTime(trackBuffer.duration)}</span>}
              </div>
              
              <div className="flex items-center gap-3">
                <Volume2 className={`w-4 h-4 ${trackMuted ? 'text-[#3f3f46]' : 'text-[#a1a1aa]'}`} />
                <input 
                  type="range" min="0" max="200" 
                  value={mixSettings.trackVolume}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    updateSetting('trackVolume', val);
                    if (isPlaying && !trackMuted) {
                      setTrackVolumeLive(val);
                    }
                    if (audioRef.current) audioRef.current.volume = Math.min(val / 100, 1);
                  }}
                  className={`flex-1 h-1 bg-white/10 rounded-full outline-none appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white transition-opacity ${trackMuted ? 'opacity-50' : ''}`}
                />
                <span className={`text-xs font-mono w-7 text-right ${trackMuted ? 'text-[#3f3f46]' : 'text-[#a1a1aa]'}`}>{mixSettings.trackVolume}</span>
              </div>
            </div>
            
            <div className={`flex-1 relative bg-transparent transition-opacity ${trackMuted ? 'opacity-30' : 'opacity-100'}`}>
              {trackBuffer ? (
                <StaticWaveform 
                  buffer={trackBuffer} 
                  color="#00E5FF" 
                  duration={trackBuffer.duration} 
                  currentTime={currentTime} 
                  totalDuration={masterDuration}
                  onSeekStart={handleSeekStart} onSeekDrag={handleSeekDrag} onSeekEnd={handleSeekEnd}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <button 
                    onClick={() => document.getElementById('file-upload')?.click()}
                    className="border-2 border-dashed border-white/10 px-6 py-2.5 rounded-xl text-sm font-medium text-[#71717a] hover:bg-[#161B22] hover:border-[#38bdf8] hover:text-white transition-all"
                  >
                    Click to Load Instrumental Track
                  </button>
                  <input id="file-upload" type="file" accept="audio/*" onChange={handleTrackUpload} className="hidden" />
                </div>
              )}
            </div>
          </div>

          {/* TRACK 2: VOCALS */}
          <div className="flex h-36 border border-white/10 bg-[#161B22] rounded-xl overflow-hidden shadow-sm">
            <div className="w-72 p-5 flex flex-col justify-between border-r border-white/10 shrink-0 bg-[#161B22]">
              <div className="flex-1">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2 overflow-hidden pr-2">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${isRecording ? 'bg-[#ef4444] animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.8)]' : 'bg-[#3f3f46]'}`} />
                    <span className="font-bold text-sm text-white truncate">🎤 Your Voice</span>
                    {(isPlaying || isRecording) && (
                      <div className="flex items-end gap-[2px] h-3 ml-1 shrink-0">
                        <div className="w-[3px] bg-[#F43F5E] animate-pulse h-full rounded-t-sm" />
                        <div className="w-[3px] bg-[#F59E0B] animate-pulse-2 h-full rounded-t-sm" style={{ animationDelay: '0.2s' }} />
                        <div className="w-[3px] bg-[#F43F5E] animate-pulse-3 h-full rounded-t-sm" style={{ animationDelay: '0.4s' }} />
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {vocalBuffer && (
                      <button 
                        onClick={() => {
                           if(confirm("Delete this vocal recording?")) {
                              if (isPlaying) handleStopClick();
                              setRecordedBlob(null);
                              clearVocal();
                           }
                        }}
                        className="w-6 h-6 rounded-xl border border-transparent text-[#71717a] hover:text-[#ef4444] hover:bg-[#ef4444]/10 transition-colors flex items-center justify-center"
                        title="Delete Vocals"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {vocalBuffer && (
                      <button 
                        onClick={handlePlayPauseClick} 
                        className={`w-6 h-6 rounded-xl border flex items-center justify-center transition-all ${
                          (isPlaying) || (isRecording && !isRecPaused)
                            ? 'bg-[#10b981] border-[#10b981] text-white shadow-[0_0_10px_rgba(16,185,129,0.3)] hover:scale-110'
                            : 'bg-transparent border-[#10b981] text-[#10b981] hover:bg-[#10b981] hover:text-white hover:scale-110'
                        }`}
                        title="Play/Pause Mix"
                      >
                        {(isPlaying) || (isRecording && !isRecPaused) ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current ml-0.5" />}
                      </button>
                    )}
                    <button 
                      onClick={() => setVocalMuted(!vocalMuted)}
                      className={`w-6 h-6 rounded-xl border flex items-center justify-center transition-all ${vocalMuted ? 'bg-[#ef4444] border-[#ef4444] text-white shadow-[0_0_10px_rgba(239,68,68,0.3)] hover:scale-110' : 'bg-transparent border-[#3f3f46] text-[#71717a] hover:text-white hover:border-[#71717a] hover:scale-110'}`}
                      title={vocalMuted ? "Unmute Vocals" : "Mute Vocals"}
                    >
                      M
                    </button>
                  </div>
                </div>
                {vocalBuffer && <span className="text-[11px] font-mono text-[#fb7185] mt-1.5 inline-block">{formatTime(currentTime)} / {formatTime(vocalBuffer.duration)}</span>}
              </div>
              
              <div className="flex items-center gap-3">
                <Mic2 className={`w-4 h-4 ${vocalMuted ? 'text-[#3f3f46]' : 'text-[#a1a1aa]'}`} />
                <input 
                  type="range" min="0" max="200" 
                  value={mixSettings.vocalVolume}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    updateSetting('vocalVolume', val);
                    if (isPlaying && !vocalMuted) {
                      setVocalVolumeLive(val);
                    }
                  }}
                  className={`flex-1 h-1 bg-white/10 rounded-full outline-none appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white transition-opacity ${vocalMuted ? 'opacity-50' : ''}`}
                />
                <span className={`text-xs font-mono w-7 text-right ${vocalMuted ? 'text-[#3f3f46]' : 'text-[#a1a1aa]'}`}>{mixSettings.vocalVolume}</span>
              </div>
            </div>
            
            <div className={`flex-1 relative bg-transparent transition-opacity ${vocalMuted ? 'opacity-30' : 'opacity-100'}`}>
              {isRecording ? (
                <div className="absolute inset-0">
                  <canvas ref={canvasRef} className="w-full h-full" />
                </div>
              ) : vocalBuffer ? (
                <StaticWaveform 
                  buffer={vocalBuffer} 
                  color="#8B5CF6" 
                  duration={vocalBuffer.duration} 
                  currentTime={currentTime}
                  totalDuration={masterDuration}
                  onSeekStart={handleSeekStart} onSeekDrag={handleSeekDrag} onSeekEnd={handleSeekEnd}
                />
              ) : (
                <StaticWaveform 
                  buffer={null} 
                  color="#8B5CF6" 
                  duration={0} 
                  currentTime={0} 
                  emptyText="Ready to Record"
                />
              )}
            </div>
          </div>

          {/* MASTER BUS SETTINGS (Docked at bottom) */}
          <div className="p-6 bg-[#161B22] border border-white/10 rounded-xl flex flex-col md:flex-row gap-8 shadow-sm">
            <div className="flex-1">
              <h3 className="text-xs font-bold text-[#71717a] uppercase tracking-wider mb-4 flex items-center gap-2">
                ⏱️ Sync & Mic Delay
              </h3>
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium text-[#a1a1aa] w-24">Delay Offset</span>
                <input 
                  type="range" min="-300" max="300" 
                  value={mixSettings.latencyOffsetMs}
                  onChange={(e) => updateSetting('latencyOffsetMs', Number(e.target.value))}
                  className="flex-1 h-1 bg-white/10 rounded-full outline-none appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
                />
                <span className="text-sm font-mono font-medium text-white w-14 text-right">{mixSettings.latencyOffsetMs}ms</span>
              </div>
              <span className="text-xs font-medium text-[#71717a] mt-3 block">
                Nudge timing backward or forward if your Bluetooth microphone is out of sync.
              </span>
            </div>
            
            <div className="flex-1 md:border-l border-white/10 md:pl-8 pt-6 md:pt-0 border-t md:border-t-0">
              <h3 className="text-xs font-bold text-[#71717a] uppercase tracking-wider mb-4 flex items-center gap-2">
                🎛️ Master Effects
              </h3>
              <div className={`flex items-center justify-between p-3 rounded-xl border transition-all ${mixSettings.reverbEnabled ? 'bg-[#8B5CF6]/10 border-[#8B5CF6]/50 shadow-[0_0_15px_rgba(139,92,246,0.15)]' : 'bg-transparent border-white/10'}`}>
                <span className={`text-sm font-bold ${mixSettings.reverbEnabled ? 'text-[#8B5CF6] drop-shadow-[0_0_8px_rgba(139,92,246,0.5)]' : 'text-[#fafafa]'}`}>Studio Reverb (Vocals)</span>
                <button 
                  onClick={() => updateSetting('reverbEnabled', !mixSettings.reverbEnabled)}
                  className={`w-14 h-7 rounded-full transition-all relative border-2 flex items-center shadow-inner ${mixSettings.reverbEnabled ? 'bg-gradient-to-r from-[#8B5CF6] to-[#06B6D4] border-transparent shadow-[0_0_15px_rgba(139,92,246,0.6)]' : 'bg-[#1f222b] border-[#3f3f46]'}`}
                >
                  <div className={`w-5 h-5 rounded-full bg-white transition-all shadow-md transform ${mixSettings.reverbEnabled ? 'translate-x-7 scale-110 drop-shadow-[0_0_5px_white]' : 'translate-x-0.5'}`} />
                </button>
              </div>
              <span className="text-xs font-medium text-[#71717a] mt-3 block">
                Adds a professional studio echo to your voice when exporting.
              </span>
            </div>
          </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 bg-transparent overflow-hidden gap-4">
            {lyrics.length === 0 ? (
              <div className="flex-1 flex flex-col max-w-2xl mx-auto w-full pt-8">
                <label className="text-sm font-bold text-gray-400 mb-2">Paste Lyrics</label>
                <textarea
                  value={rawLyricsText}
                  onChange={e => setRawLyricsText(e.target.value)}
                  className="flex-1 bg-[#161B22] text-gray-200 p-4 rounded-xl border border-white/10 focus:outline-none focus:border-[#38bdf8] resize-none"
                  placeholder="Paste lyrics here..."
                />
                <button 
                  onClick={() => {
                    const lines = rawLyricsText.split('\n').map(l => l.trim()).filter(l => l);
                    setLyrics(lines.map((text, idx) => ({ id: `line-${Date.now()}-${idx}`, text, start: null, end: null })));
                  }}
                  className="w-full mt-4 py-3 bg-white text-black rounded font-bold hover:bg-[#0ea5e9] transition-colors"
                >
                  Generate Timeline
                </button>
              </div>
            ) : activeTab === "SYNC" ? (
              <div className="flex-1 flex flex-col h-full gap-4 min-h-0">
                <div className="shrink-0 flex flex-col items-center justify-center py-4 border border-white/10 rounded-xl bg-[#161B22] shadow-sm">
                  <div className="flex items-center justify-between w-full max-w-5xl px-4">
                    {/* Left: Secondary Actions (Empty) */}
                    <div className="flex items-center gap-3 w-1/3 justify-start">
                    </div>

                    {/* Center: Primary Sync Actions */}
                    <div className="flex items-center justify-center gap-3 w-1/3 whitespace-nowrap">
                      <button 
                        onClick={(e) => { 
                          e.currentTarget.blur(); 
                          if (isPlaying) {
                            if (isSyncSessionActive) {
                              triggerSyncTap();
                            } else {
                              stopPreview();
                            }
                          } else {
                            if (isSyncSessionActive) {
                              startPlayback(currentTime);
                            } else {
                              if (hasSyncedLines) {
                                if (currentTime === 0) {
                                  if (audioRef.current) audioRef.current.currentTime = 0;
                                  setActiveLineIndex(0);
                                }
                                startPlayback(currentTime);
                              } else {
                                setIsSyncSessionActive(true);
                                if (audioRef.current) audioRef.current.currentTime = 0;
                                setCurrentTime(0);
                                setActiveLineIndex(0);
                                startPlayback(0);
                              }
                            }
                          }
                        }}
                        disabled={!trackUrl}
                        className={`flex items-center justify-center gap-2 px-6 py-2.5 rounded-full font-bold text-sm transition-transform hover:scale-105 ${isPlaying && isSyncSessionActive ? 'bg-red-500 text-white' : isPlaying && !isSyncSessionActive ? 'bg-amber-500 text-black' : 'bg-white text-black'} disabled:opacity-50 min-w-[200px]`}
                      >
                        {isPlaying 
                          ? (isSyncSessionActive ? 'Tap Spacebar to Sync' : '⏸ Stop Review') 
                          : (isSyncSessionActive 
                              ? '▶ Resume Syncing' 
                              : (hasSyncedLines 
                                  ? (currentTime > 0 ? '▶ Resume Review' : '▶ Review Sync') 
                                  : '▶ Start Syncing')
                            )
                        }
                      </button>

                      {isSyncSessionActive && (
                        <button 
                          onClick={(e) => {
                            e.currentTarget.blur();
                            if (isPlaying) stopPreview();
                            setIsSyncSessionActive(false);
                          }}
                          className="flex items-center justify-center gap-2 px-6 py-2.5 bg-[#1ed760] hover:bg-[#1db954] text-black rounded-full font-bold text-sm transition-colors"
                        >
                          ✓ Finish
                        </button>
                      )}
                    </div>

                    {/* Right: Danger Actions (Clear/Restart) */}
                    <div className="flex items-center gap-3 w-1/3 justify-end whitespace-nowrap">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          e.currentTarget.blur();
                          if (isPlaying) stopPreview();
                          if (audioRef.current) {
                            audioRef.current.pause();
                            audioRef.current.currentTime = 0;
                          }
                          setCurrentTime(0);
                          setActiveLineIndex(0);
                          setLyrics(prev => prev.map(l => ({ ...l, start: null, end: null })));
                          setIsSyncSessionActive(false);
                        }}
                        disabled={!hasSyncedLines && currentTime === 0}
                        className="px-4 py-2.5 bg-transparent text-white/70 hover:text-white text-xs font-medium rounded-full hover:bg-white/5 transition-colors border border-white/10 disabled:opacity-30"
                      >
                        🔄 Restart Sync
                      </button>
                      <button onClick={(e) => { 
                        e.stopPropagation(); 
                        if (window.confirm("Wipe out all lyrics entirely? This cannot be undone.")) {
                          if (isPlaying) stopPreview();
                          if (audioRef.current) {
                            audioRef.current.pause();
                            audioRef.current.currentTime = 0;
                          }
                          setCurrentTime(0);
                          setLyrics([]); 
                          setRawLyricsText('');
                          setActiveLineIndex(0); 
                          setIsSpacebarDown(false); 
                          setIsSyncSessionActive(false);
                        }
                      }} className="px-4 py-2.5 bg-transparent hover:bg-red-500/10 text-red-500 text-xs font-medium rounded-full transition-colors border border-red-500/30">
                        Clear All Lyrics
                      </button>
                    </div>
                  </div>
                </div>
                <div 
                  className={`flex-1 overflow-y-auto custom-scrollbar bg-[#161B22] rounded-xl border border-white/10 p-8 flex flex-col items-center relative transition-colors select-none ${isSpacebarDown ? 'border-[#38bdf8] bg-white/10' : ''}`}
                >
                   {lyrics.length === 0 ? (
                     <div className="flex flex-col items-center justify-center h-full text-center max-w-md">
                       <h3 className="text-xl font-bold text-white mb-2">No Lyrics Yet</h3>
                       <p className="text-[#a1a1aa] mb-6">Upload an LRC file or type your lyrics in the Editor tab first.</p>
                       <button onClick={() => setActiveTab("EDIT")} className="px-6 py-2 bg-white text-black rounded-full font-bold shadow-[0_0_15px_rgba(56,189,248,0.3)] hover:bg-[#0ea5e9] transition-colors">Go to Editor</button>
                     </div>
                   ) : (
                     lyrics.map((line, idx) => {
                      const isSynced = line.start !== null;
                      const currentlyPlayingIdx = lyrics.findIndex(l => 
                        l.start !== null && currentTime >= l.start && (l.end === null || currentTime < l.end)
                      );
                      const glowIndex = isSyncSessionActive ? activeLineIndex : (currentlyPlayingIdx !== -1 ? currentlyPlayingIdx : activeLineIndex);
                      const isTarget = glowIndex === idx;
                      
                      // During an active sync, don't auto-highlight lines we haven't reached yet, even if they have old timestamps
                      const isSung = isSynced && (currentTime >= line.start!) && (!isSyncSessionActive || idx < activeLineIndex);
                      
                      // Unsynced lines are dim gray during sync session, otherwise normal text color
                      let textColor = '#71717a';
                      if (isSung || (isTarget && (isSyncSessionActive || isPlaying))) textColor = '#ffffff';
                      else if (!isSyncSessionActive && !isSynced) textColor = '#fafafa';

                      const isLastSyncedLine = isSynced && (idx === lyrics.length - 1 || lyrics[idx + 1].start === null);
                      const showResumeShortcut = !isSyncSessionActive && isLastSyncedLine && idx < lyrics.length - 1;

                      return (
                        <div key={line.id} className="flex flex-col mb-8 relative w-full max-w-2xl">
                          <div 
                            ref={isTarget && (isSyncSessionActive || isPlaying) ? (el) => {
                              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            } : null}
                            onClick={() => {
                              // Punch-in edit
                              if (line.start !== null) {
                                setCurrentTime(line.start);
                                if (audioRef.current) audioRef.current.currentTime = line.start;
                                setActiveLineIndex(idx);
                                if (isPlaying || isSyncSessionActive) {
                                  startPlayback(line.start);
                                }
                              } else {
                                // Clicked unsynced line
                                setActiveLineIndex(idx);
                              }
                            }}
                            className={`flex items-start justify-start gap-4 transition-all cursor-pointer hover:scale-105 origin-left ${isTarget && (isSyncSessionActive || isPlaying) ? 'scale-110 drop-shadow-md' : 'opacity-70 hover:opacity-100'}`} 
                          >
                            {/* Sleek active indicator bar */}
                            <div className={`w-1.5 h-8 mt-1.5 rounded-full shrink-0 transition-all ${isTarget && (isSyncSessionActive || isPlaying) ? 'bg-[#1db954] opacity-100 shadow-[0_0_10px_#1db954]' : 'bg-transparent opacity-0'}`} />
                            
                            <div 
                              className="text-3xl md:text-4xl font-bold transition-colors duration-200 flex items-start justify-start gap-4 flex-1"
                              style={{ color: textColor }}
                            >
                              <span className="text-xl md:text-2xl font-mono opacity-30 shrink-0 w-8 text-right mt-1.5">{idx + 1}.</span>
                              <span className="flex-1 text-left leading-tight">{line.text}</span>
                            </div>
                          </div>
                          
                          {showResumeShortcut && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveLineIndex(idx + 1);
                                setIsSyncSessionActive(true);
                                const startTime = line.end || line.start || currentTime;
                                setCurrentTime(startTime);
                                if (audioRef.current) audioRef.current.currentTime = startTime;
                                startPlayback(startTime);
                              }}
                              className="mt-4 flex items-center gap-2 px-4 py-2 bg-[#10b981]/20 hover:bg-[#10b981]/30 text-[#10b981] rounded-full text-xs font-bold transition-colors"
                            >
                              ▶ Resume Syncing From Here
                            </button>
                          )}
                        </div>
                      );
                   }))}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col h-full min-h-0">
                <div className="text-center text-sm font-bold text-[#71717a] py-2 mb-2">
                  Drag the blocks or the left/right handles to fine-tune the timing.
                </div>
                <div className="flex-1 shrink-0 bg-transparent rounded-xl border border-white/10">
                  <WaveformEditor trackUrl={trackUrl!} lyrics={lyrics} onUpdateLine={handleLineUpdate} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hidden audio element for synchronized playback DURING recording */}
      {trackUrl && (
        <audio 
          ref={audioRef} 
          src={trackUrl} 
          onEnded={() => {
            if (isRecording) {
              handleStopRecording();
            }
          }}
        />
      )}
    </div>
    </>
  );
}
