'use client';

import { useState, useRef, useEffect } from 'react';
import { Upload, Headphones, Mic, Play, Pause, Square, Settings2, Download, CheckCircle2, Volume2, Mic2 } from 'lucide-react';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useAudioMixer, MixSettings } from '@/hooks/useAudioMixer';
import { saveTrackToDB, getTrackFromDB, saveVocalToDB, getVocalFromDB } from '@/utils/indexedDB';
import { audioBufferToWav } from '@/utils/audioBufferToWav';

function StaticWaveform({ buffer, color, duration, currentTime, totalDuration, onSeekStart, onSeekDrag, onSeekEnd, emptyText = "No Audio Data" }: { buffer: AudioBuffer | null, color: string, duration: number, currentTime: number, totalDuration?: number, onSeekStart?: (time: number) => void, onSeekDrag?: (time: number) => void, onSeekEnd?: (time: number) => void, emptyText?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  
  const [isDraggingState, setIsDraggingState] = useState(false);

  useEffect(() => {
    if (!canvasRef.current || !buffer) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const data = buffer.getChannelData(0);
    const actualTotalDuration = totalDuration || buffer.duration;
    const widthProportion = Math.min(buffer.duration / actualTotalDuration, 1.0);
    const targetWidth = canvas.width * widthProportion;
    
    const step = Math.ceil(data.length / targetWidth);
    
    ctx.fillStyle = color;
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

const loadLyricsFromLocalStorage = (hash: string) => {
  const data = localStorage.getItem(`lyrics-autosave-${hash}`);
  if (!data) return null;
  try {
    return JSON.parse(data);
  } catch {
    // Corrupt entry - clean it up
    localStorage.removeItem(`lyrics-autosave-${hash}`);
    return null;
  }
};

const saveLyricsToLocalStorage = (hash: string, ly: { text: string; time: number | null }[]) => {
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
    recordedBlob, startRecording, stopRecording, pauseRecording, resumeRecording, resetRecording, getAnalyser 
  } = useAudioRecorder();

  const { 
    loadTrack, loadVocal, mergeVocal, clearVocal, playPreview, stopPreview, exportMix,
    isPlaying, isProcessing, setTrackVolumeLive, setVocalVolumeLive,
    trackBuffer, vocalBuffer 
  } = useAudioMixer();

  type Tab = "MIXER" | "LYRICS";
  const [activeTab, setActiveTab] = useState<Tab>("MIXER");
  const [rawLyricsText, setRawLyricsText] = useState("");
  const [lyrics, setLyrics] = useState<{ text: string; time: number | null }[]>([]);
  const [syncIndex, setSyncIndex] = useState(0);
  const [isLyricsLocked, setIsLyricsLocked] = useState(false);

  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const punchInTimeRef = useRef<number>(0);

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
      .filter(l => l.time !== null)
      .map(l => {
        const t = l.time!;
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
              return { text: txt, time } as typeof lyrics[0];
            }
            const txt = line.trim();
            return txt ? { text: txt, time: null } as typeof lyrics[0] : null;
          })
          .filter((l): l is typeof lyrics[0] => l !== null && l.text !== '');
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
        setCurrentTime(prev => prev + 0.1);
      }, 100);
    }
    return () => clearInterval(interval);
  }, [isRecording, isRecPaused, isPlaying]);

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
  }, [recordedBlob, loadVocal, mergeVocal, vocalBuffer]);

  const [trackMuted, setTrackMuted] = useState(false);
  const [vocalMuted, setVocalMuted] = useState(false);

  const effectiveTrackVolume = trackMuted ? 0 : mixSettings.trackVolume;
  const effectiveVocalVolume = vocalMuted || activeTab === 'LYRICS' ? 0 : mixSettings.vocalVolume;

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

  const handleSeekEnd = (time: number) => {
    if (isRecording) return;
    setCurrentTime(time);
    
    if (wasPlayingBeforeDrag.current) {
      // Restart playback from new time
      playPreview({
        ...mixSettings,
        trackVolume: effectiveTrackVolume,
        vocalVolume: effectiveVocalVolume
      }, time);
    }
  };

  const handlePlayPreviewClick = () => {
    if (isPlaying) {
      stopPreview();
    } else {
      playPreview({
        ...mixSettings,
        trackVolume: effectiveTrackVolume,
        vocalVolume: effectiveVocalVolume
      }, currentTime); // Pass currentTime so it plays from where playhead is!
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

  // Enter Key Syncing Logic
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeTab === "LYRICS" && e.key === "Enter") {
        if (isLyricsLocked) return;
        const activeTag = document.activeElement?.tagName;
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
        
        e.preventDefault(); // Prevent page scroll or weird default behavior
        
        if (!isPlaying) {
          console.warn("Please hit play first to sync!");
          return;
        }

        if (syncIndex < lyrics.length) {
          setLyrics(prev => {
            const next = [...prev];
            next[syncIndex] = { ...next[syncIndex], time: currentTime };
            return next;
          });
          setSyncIndex(prev => prev + 1);
        }
      }
    };
    // Use capture phase to guarantee we intercept it
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [activeTab, isPlaying, syncIndex, lyrics.length, currentTime, isLyricsLocked]);

  return (
    <div className="min-h-screen bg-[#0d0e12] text-[#fafafa] font-sans flex flex-col overflow-hidden">
      
      {/* HEADER */}
      <header className="h-16 shrink-0 flex items-center justify-between border-b border-[#1f222b] bg-[#16181f] px-8 shadow-sm">
        <div className="flex items-center gap-6">
          <h1 className="text-lg font-black tracking-tighter text-white flex items-center gap-2">
            <Mic2 className="w-5 h-5 text-[#38bdf8]" />
            KARAOKE STUDIO
          </h1>
          
          <div className="h-6 w-px bg-[#1f222b] mx-2" />
          {/* VIEW TOGGLE */}
          <div className="flex bg-[#0d0e12] p-1 rounded-md border border-[#1f222b]">
            <button onClick={() => setActiveTab("MIXER")} className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${activeTab === "MIXER" ? "bg-[#38bdf8] text-gray-900 shadow-sm" : "text-[#71717a] hover:text-[#fafafa]"}`}>🎛️ Mixer</button>
            <button onClick={() => setActiveTab("LYRICS")} className={`px-3 py-1.5 rounded text-xs font-bold transition-all ${activeTab === "LYRICS" ? "bg-[#38bdf8] text-gray-900 shadow-sm" : "text-[#71717a] hover:text-[#fafafa]"}`}>📝 Lyrics</button>
          </div>
          <div className="h-6 w-px bg-[#1f222b] mx-2" />


          {/* Unified Transport Controls */}
          <div className="flex items-center gap-3">
            {/* Master Play Button */}
            <button 
              onClick={handlePlayPauseClick} 
              disabled={isRecording || !trackBuffer}
              className={`w-12 h-12 rounded-full border-2 flex items-center justify-center transition-all ${
                (isPlaying)
                  ? 'bg-[#10b981] border-[#10b981] text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]'
                  : 'bg-[#0d0e12] border-[#10b981] text-[#10b981] hover:bg-[#10b981] hover:text-white disabled:opacity-50 disabled:pointer-events-none'
              }`}
              title="Play/Pause"
            >
              {(isPlaying) ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-1" />}
            </button>

            {/* Record Button */}
            <button 
              onClick={handleStartRecording}
              disabled={isRecording || isPlaying || !trackFile}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                isRecording 
                  ? 'bg-transparent border-2 border-[#ef4444] shadow-[0_0_20px_rgba(239,68,68,0.7)] animate-pulse' 
                  : 'bg-[#0d0e12] border-2 border-[#ef4444] hover:bg-[#ef4444]/10 disabled:opacity-50 disabled:pointer-events-none'
              }`}
              title="Record"
            >
              <div className={`rounded-full transition-all ${isRecording ? 'w-4 h-4 bg-[#ef4444]' : 'w-4 h-4 bg-[#ef4444]'}`} />
            </button>

            {/* Stop Button */}
            <button 
              onClick={handleStopClick}
              disabled={!isRecording && !isPlaying && currentTime === 0}
              className="w-10 h-10 ml-2 rounded bg-[#0d0e12] border border-[#3f3f46] text-[#a1a1aa] hover:bg-[#3f3f46] hover:text-white flex items-center justify-center transition-colors disabled:opacity-50 disabled:pointer-events-none"
              title="Stop"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
            {/* Hidden file inputs */}
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              id="file-upload"
              onChange={handleTrackUpload}
            />
            <input
              type="file"
              accept=".lrc"
              className="hidden"
              id="lrc-upload"
              onChange={handleLRCUpload}
            />
            {/* Action Buttons */}
            {activeTab === "MIXER" && (
              <button
                onClick={() => document.getElementById('file-upload')?.click()}
                className="px-5 py-2.5 bg-[#38bdf8] hover:bg-[#0ea5e9] text-gray-900 rounded-md text-xs font-bold tracking-wide transition-all shadow-[0_0_15px_rgba(56,189,248,0.3)] disabled:opacity-50 disabled:pointer-events-none"
                title="Upload Instrumental"
              >
                📤 Upload Track
              </button>
            )}
            {activeTab === "LYRICS" && (
              <>
                <button
                  onClick={() => document.getElementById('lrc-upload')?.click()}
                  className="px-5 py-2.5 bg-[#38bdf8] hover:bg-[#0ea5e9] text-gray-900 rounded-md text-xs font-bold tracking-wide transition-all shadow-[0_0_15px_rgba(56,189,248,0.3)] disabled:opacity-50 disabled:pointer-events-none"
                  title="Upload LRC"
                >
                  📄 Upload .LRC
                </button>
                <button
                  onClick={handleExportLRC}
                  disabled={lyrics.length === 0 || !trackFile}
                  className="px-5 py-2.5 bg-[#38bdf8] hover:bg-[#0ea5e9] text-gray-900 rounded-md text-xs font-bold tracking-wide transition-all shadow-[0_0_15px_rgba(56,189,248,0.3)] disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
                >
                  ⬇️ Download .LRC
                </button>
              </>
            )}
{activeTab === "MIXER" && (
  <button
    onClick={handleExportClick}
    disabled={isProcessing || !recordedBlob}
    className="px-5 py-2.5 bg-[#38bdf8] hover:bg-[#0ea5e9] text-gray-900 rounded-md text-xs font-bold tracking-wide transition-all shadow-[0_0_15px_rgba(56,189,248,0.3)] disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
  >
    {isProcessing ? 'PROCESSING...' : '⬇️ Download Mixed Song'}
  </button>
)}
          </div>
        </div>
      </header>

      {/* TIMELINE AREA */}
      <div className="flex-1 p-8 overflow-y-auto">
        {activeTab === 'MIXER' ? (
          <div className="max-w-6xl mx-auto space-y-6">
            
            {/* TELEPROMPTER */}
            {lyrics.some(l => l.time !== null) && (
              (() => {
                let currentIdx = -1;
                for (let i = lyrics.length - 1; i >= 0; i--) {
                  if (lyrics[i].time !== null && lyrics[i].time! <= currentTime) {
                    currentIdx = i;
                    break;
                  }
                }
                const currentText = currentIdx >= 0 ? lyrics[currentIdx].text : "Get ready...";
                let nextText = "";
                for (let i = currentIdx + 1; i < lyrics.length; i++) {
                   if (lyrics[i].text.trim() !== "") {
                     nextText = lyrics[i].text;
                     break;
                   }
                }
                
                return (
                  <div className="bg-[#16181f] border border-[#1f222b] rounded-lg p-6 flex flex-col items-center justify-center min-h-[120px] shadow-sm">
                    <span className="text-3xl font-black text-[#38bdf8] text-center drop-shadow-md tracking-tight">
                      {currentText}
                    </span>
                    <span className="text-sm font-medium text-[#71717a] text-center mt-3">
                      {nextText}
                    </span>
                  </div>
                );
              })()
            )}

          {/* TRACK 1: BACKING TRACK */}
          <div className="flex h-36 border border-[#1f222b] bg-[#16181f] rounded-lg overflow-hidden shadow-sm">
            <div className="w-72 p-5 flex flex-col justify-between border-r border-[#1f222b] shrink-0 bg-[#16181f]">
              <div className="flex-1">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2 overflow-hidden pr-2">
                    <span className="font-bold text-sm text-white truncate">🎵 Instrumental Track</span>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {trackBuffer && (
                      <button 
                        onClick={handlePlayPauseClick} 
                        className={`w-6 h-6 rounded border flex items-center justify-center transition-all ${
                          (isPlaying) || (isRecording && !isRecPaused)
                            ? 'bg-[#10b981] border-[#10b981] text-white shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                            : 'bg-[#0d0e12] border-[#10b981] text-[#10b981] hover:bg-[#10b981] hover:text-white'
                        }`}
                        title="Play/Pause Mix"
                      >
                        {(isPlaying) || (isRecording && !isRecPaused) ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current ml-0.5" />}
                      </button>
                    )}
                    <button 
                      onClick={() => setTrackMuted(!trackMuted)}
                      className={`w-6 h-6 rounded border text-[10px] font-bold transition-all ${trackMuted ? 'bg-[#38bdf8] border-[#38bdf8] text-gray-900' : 'bg-[#0d0e12] border-[#3f3f46] text-[#a1a1aa] hover:border-[#38bdf8] hover:text-[#38bdf8]'}`}
                    >
                      M
                    </button>
                  </div>
                </div>
                {trackFile && <span className="text-xs text-[#71717a] font-medium truncate block">{trackFile.name}</span>}
                {trackBuffer && <span className="text-[11px] font-mono text-[#38bdf8] mt-1.5 inline-block">{formatTime(currentTime)} / {formatTime(trackBuffer.duration)}</span>}
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
                  className={`flex-1 h-1.5 rounded-full outline-none appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full transition-opacity ${trackMuted ? 'bg-[#0d0e12] opacity-50 [&::-webkit-slider-thumb]:bg-[#3f3f46]' : 'bg-[#1f222b] [&::-webkit-slider-thumb]:bg-[#38bdf8]'}`}
                />
                <span className={`text-xs font-mono w-7 text-right ${trackMuted ? 'text-[#3f3f46]' : 'text-[#a1a1aa]'}`}>{mixSettings.trackVolume}</span>
              </div>
            </div>
            
            <div className={`flex-1 relative bg-[#0d0e12] transition-opacity ${trackMuted ? 'opacity-30' : 'opacity-100'}`}>
              {trackBuffer ? (
                <StaticWaveform 
                  buffer={trackBuffer} 
                  color="#38bdf8" 
                  duration={trackBuffer.duration} 
                  currentTime={currentTime} 
                  totalDuration={masterDuration}
                  onSeekStart={handleSeekStart} onSeekDrag={handleSeekDrag} onSeekEnd={handleSeekEnd}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <button 
                    onClick={() => document.getElementById('file-upload')?.click()}
                    className="border-2 border-dashed border-[#1f222b] px-6 py-2.5 rounded-lg text-sm font-medium text-[#71717a] hover:bg-[#16181f] hover:border-[#38bdf8] hover:text-[#38bdf8] transition-all"
                  >
                    Click to Load Instrumental Track
                  </button>
                  <input id="file-upload" type="file" accept="audio/*" onChange={handleTrackUpload} className="hidden" />
                </div>
              )}
            </div>
          </div>

          {/* TRACK 2: VOCALS */}
          <div className="flex h-36 border border-[#1f222b] bg-[#16181f] rounded-lg overflow-hidden shadow-sm">
            <div className="w-72 p-5 flex flex-col justify-between border-r border-[#1f222b] shrink-0 bg-[#16181f]">
              <div className="flex-1">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2 overflow-hidden pr-2">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${isRecording ? 'bg-[#ef4444] animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.8)]' : 'bg-[#3f3f46]'}`} />
                    <span className="font-bold text-sm text-white truncate">🎤 Your Voice</span>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {vocalBuffer && (
                      <button 
                        onClick={handlePlayPauseClick} 
                        className={`w-6 h-6 rounded border flex items-center justify-center transition-all ${
                          (isPlaying) || (isRecording && !isRecPaused)
                            ? 'bg-[#10b981] border-[#10b981] text-white shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                            : 'bg-[#0d0e12] border-[#10b981] text-[#10b981] hover:bg-[#10b981] hover:text-white'
                        }`}
                        title="Play/Pause Mix"
                      >
                        {(isPlaying) || (isRecording && !isRecPaused) ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current ml-0.5" />}
                      </button>
                    )}
                    <button 
                      onClick={() => setVocalMuted(!vocalMuted)}
                      className={`w-6 h-6 rounded border text-[10px] font-bold transition-all ${vocalMuted ? 'bg-[#fb7185] border-[#fb7185] text-gray-900' : 'bg-[#0d0e12] border-[#3f3f46] text-[#a1a1aa] hover:border-[#fb7185] hover:text-[#fb7185]'}`}
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
                  className={`flex-1 h-1.5 rounded-full outline-none appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full transition-opacity ${vocalMuted ? 'bg-[#0d0e12] opacity-50 [&::-webkit-slider-thumb]:bg-[#3f3f46]' : 'bg-[#1f222b] [&::-webkit-slider-thumb]:bg-[#fb7185]'}`}
                />
                <span className={`text-xs font-mono w-7 text-right ${vocalMuted ? 'text-[#3f3f46]' : 'text-[#a1a1aa]'}`}>{mixSettings.vocalVolume}</span>
              </div>
            </div>
            
            <div className={`flex-1 relative bg-[#0d0e12] transition-opacity ${vocalMuted ? 'opacity-30' : 'opacity-100'}`}>
              {isRecording ? (
                <div className="absolute inset-0">
                  <canvas ref={canvasRef} className="w-full h-full" />
                </div>
              ) : vocalBuffer ? (
                <StaticWaveform 
                  buffer={vocalBuffer} 
                  color="#fb7185" 
                  duration={vocalBuffer.duration} 
                  currentTime={currentTime}
                  totalDuration={masterDuration}
                  onSeekStart={handleSeekStart} onSeekDrag={handleSeekDrag} onSeekEnd={handleSeekEnd}
                />
              ) : (
                <StaticWaveform 
                  buffer={null} 
                  color="#fb7185" 
                  duration={0} 
                  currentTime={currentTime}
                  totalDuration={masterDuration}
                  onSeekStart={handleSeekStart} onSeekDrag={handleSeekDrag} onSeekEnd={handleSeekEnd}
                  emptyText="Ready to record vocals"
                />
              )}
            </div>
          </div>

          {/* MASTER BUS SETTINGS (Docked at bottom) */}
          <div className="p-6 bg-[#16181f] border border-[#1f222b] rounded-lg flex flex-col md:flex-row gap-8 shadow-sm">
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
                  className="flex-1 h-1.5 bg-[#1f222b] rounded-full outline-none appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-[#38bdf8] [&::-webkit-slider-thumb]:rounded-full"
                />
                <span className="text-sm font-mono font-medium text-[#38bdf8] w-14 text-right">{mixSettings.latencyOffsetMs}ms</span>
              </div>
              <span className="text-xs font-medium text-[#71717a] mt-3 block">
                Nudge timing backward or forward if your Bluetooth microphone is out of sync.
              </span>
            </div>
            
            <div className="flex-1 md:border-l border-[#1f222b] md:pl-8 pt-6 md:pt-0 border-t md:border-t-0">
              <h3 className="text-xs font-bold text-[#71717a] uppercase tracking-wider mb-4 flex items-center gap-2">
                🎛️ Master Effects
              </h3>
              <div className="flex items-center justify-between bg-[#0d0e12] p-3 rounded border border-[#1f222b]">
                <span className="text-sm font-medium text-[#fafafa]">Studio Reverb (Vocals)</span>
                <button 
                  onClick={() => updateSetting('reverbEnabled', !mixSettings.reverbEnabled)}
                  className={`w-11 h-6 rounded-full transition-all relative border ${mixSettings.reverbEnabled ? 'bg-[#38bdf8] border-[#38bdf8]' : 'bg-[#1f222b] border-[#3f3f46]'}`}
                >
                  <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${mixSettings.reverbEnabled ? 'translate-x-5' : ''}`} />
                </button>
              </div>
              <span className="text-xs font-medium text-[#71717a] mt-3 block">
                Adds a professional studio echo to your voice when exporting.
              </span>
            </div>
          </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto h-full flex flex-col bg-[#16181f] border border-[#1f222b] rounded-lg shadow-sm">
            <div className="p-6 border-b border-[#1f222b] flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">📝 Lyrics Studio</h2>
                <p className="text-xs text-[#a1a1aa] mt-1">
                  Hit play, then <strong>tap any unsynced line</strong> (or hit <kbd className="bg-[#1f222b] px-1.5 py-0.5 rounded border border-[#3f3f46]">Enter</kbd>) to sync it. <br/>
                  <strong>Click a synced line</strong> to jump to that part of the song and resume syncing!
                </p>
              </div>
              <div className="flex gap-2">
                {lyrics.length > 0 && (
                  <>
                    <button 
                      onClick={handlePlayPreviewClick}
                      disabled={!trackBuffer}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded text-xs font-bold transition-colors ${isPlaying ? 'bg-[#ef4444] text-white hover:bg-[#dc2626]' : 'bg-[#38bdf8] text-gray-900 hover:bg-[#0ea5e9]'} disabled:opacity-50`}
                    >
                      {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      {isPlaying ? 'Pause' : 'Play'}
                    </button>
                    <button 
                      onClick={() => setIsLyricsLocked(!isLyricsLocked)} 
                      className={`px-4 py-2 rounded text-xs font-bold transition-colors ${isLyricsLocked ? 'bg-[#3f3f46] text-white hover:bg-[#27272a]' : 'bg-[#10b981] text-white hover:bg-[#059669]'}`}
                    >
                      {isLyricsLocked ? '🔓 Unlock' : '🔒 Lock Lyrics'}
                    </button>
                  </>
                )}
                {!isLyricsLocked && (
                  <button 
                    onClick={() => {
                      if (!isPlaying) {
                      console.warn("Please hit play first to sync!");
                      return;
                    }
                    if (syncIndex < lyrics.length) {
                      setLyrics(prev => {
                        const next = [...prev];
                        next[syncIndex] = { ...next[syncIndex], time: currentTime };
                        return next;
                      });
                      setSyncIndex(prev => prev + 1);
                    }
                  }} 
                  disabled={lyrics.length === 0 || syncIndex >= lyrics.length || !isPlaying}
                  className="px-4 py-2 bg-[#10b981] text-white rounded text-xs font-bold hover:bg-[#059669] transition-colors disabled:opacity-50 disabled:pointer-events-none"
                >
                  Sync Next Line (Enter)
                  </button>
                )}
                <button onClick={() => { setLyrics([]); setSyncIndex(0); setRawLyricsText(""); setIsLyricsLocked(false); }} className="px-4 py-2 bg-[#0d0e12] border border-[#1f222b] text-[#ef4444] rounded text-xs font-bold hover:bg-[#ef4444]/10 transition-colors">Clear All</button>
              </div>
            </div>
            <div className="flex-1 p-6 overflow-hidden flex flex-col">
              {lyrics.length === 0 ? (
                <div className="flex-1 flex flex-col">
                  <textarea 
                    value={rawLyricsText} 
                    onChange={e => setRawLyricsText(e.target.value)} 
                    placeholder="Paste your plain text lyrics here..." 
                    className="flex-1 w-full bg-[#0d0e12] border border-[#1f222b] rounded p-4 text-sm text-[#fafafa] font-mono outline-none focus:border-[#38bdf8] resize-none mb-4"
                  />
                  <button 
                    onClick={() => {
                      const lines = rawLyricsText.split('\n').filter(l => l.trim() !== '');
                      setLyrics(lines.map(text => ({ text, time: null })));
                      setSyncIndex(0);
                    }}
                    disabled={!rawLyricsText.trim()}
                    className="w-full py-3 bg-[#38bdf8] text-gray-900 rounded font-bold text-sm hover:bg-[#0ea5e9] transition-colors disabled:opacity-50"
                  >
                    Start Syncing Mode
                  </button>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto space-y-2 pr-4 custom-scrollbar">
                  {lyrics.map((line, idx) => {
                    const isSynced = line.time !== null;
                    const isCurrentSync = idx === syncIndex;
                    const isPlayingNow = isSynced && line.time! <= currentTime && (idx === lyrics.length - 1 || (lyrics[idx + 1].time === null || currentTime < lyrics[idx + 1].time!));
                    
                    return (
                      <div 
                        key={idx} 
                        onClick={() => {
                          if (isSynced) {
                            handleSeekEnd(line.time!);
                            if (!isLyricsLocked) {
                              setSyncIndex(idx);
                            }
                            if (!isPlaying) handlePlayPreviewClick();
                            return;
                          }

                          if (isLyricsLocked) return;
                          if (!isPlaying) {
                            console.warn("Please hit play first to sync!");
                            return;
                          }
                          setLyrics(prev => {
                            const next = [...prev];
                            next[idx] = { ...next[idx], time: currentTime };
                            return next;
                          });
                          setSyncIndex(idx + 1);
                        }}
                        className={`flex items-center gap-4 p-3 rounded transition-all ${isSynced || !isLyricsLocked ? 'cursor-pointer hover:bg-[#1f222b]' : ''} ${isPlayingNow ? 'bg-[#38bdf8]/20 border border-[#38bdf8]/50' : isCurrentSync && !isLyricsLocked ? 'bg-[#1f222b] border border-[#3f3f46] shadow-sm' : 'border border-transparent'}`}
                      >
                        <div className="w-16 shrink-0 text-right" title={isSynced ? "Click to play from here" : ""}>
                          {isSynced ? (
                            <span className="text-xs font-mono text-[#10b981]">{formatTime(line.time!)}</span>
                          ) : (
                            <span className="text-xs font-mono text-[#71717a]">--:--.-</span>
                          )}
                        </div>
                        <div className={`flex-1 text-sm transition-all ${isPlayingNow ? 'text-[#38bdf8] font-bold text-base' : isSynced ? 'text-[#fafafa]' : isCurrentSync ? 'text-white font-bold' : 'text-[#71717a]'}`}>
                          {line.text}
                        </div>
                        {isCurrentSync && !isLyricsLocked && (
                          <div className="text-[10px] font-bold text-[#fb7185] bg-[#fb7185]/10 px-2 py-1 rounded animate-pulse">
                            NEXT TO SYNC
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
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
  );
}
