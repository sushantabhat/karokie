'use client';

import { useState, useRef, useEffect } from 'react';
import { Upload, Headphones, Mic, Play, Pause, Square, Settings2, Download, CheckCircle2, Volume2, Mic2 } from 'lucide-react';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useAudioMixer, MixSettings } from '@/hooks/useAudioMixer';

function StaticWaveform({ buffer, color, duration, currentTime, totalDuration, onSeekStart, onSeekDrag, onSeekEnd, emptyText = "No Audio Data" }: { buffer: AudioBuffer | null, color: string, duration: number, currentTime: number, totalDuration?: number, onSeekStart?: (time: number) => void, onSeekDrag?: (time: number) => void, onSeekEnd?: (time: number) => void, emptyText?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  
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
    const amp = canvas.height / 2;
    
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
        if (onSeekEnd) onSeekEnd(calculateSeekTime(e.clientX));
      }
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
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
        style={{ left: `${Math.min(progress, 100)}%`, transition: isDragging.current ? 'none' : 'left 0.1s linear' }}
      />
    </div>
  );
}

export default function KaraokeStudio() {
  const [trackFile, setTrackFile] = useState<File | null>(null);
  const [trackUrl, setTrackUrl] = useState<string | null>(null);
  const [headphonesConfirmed, setHeadphonesConfirmed] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  
  const { 
    isRecording, isPaused: isRecPaused, 
    recordedBlob, startRecording, stopRecording, pauseRecording, resumeRecording, resetRecording, analyser 
  } = useAudioRecorder();

  const { 
    loadTrack, loadVocal, mergeVocal, clearVocal, playPreview, stopPreview, exportMix,
    isPlaying, isProcessing, setTrackVolumeLive, setVocalVolumeLive,
    trackBuffer, vocalBuffer 
  } = useAudioMixer();

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

  const updateSetting = (key: keyof MixSettings, value: any) => {
    setMixSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleTrackUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setTrackFile(file);
      const url = URL.createObjectURL(file);
      setTrackUrl(url);
      await loadTrack(file);
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
  }, [isRecording, isRecPaused, analyser]);

  // Reset time when stopping
  useEffect(() => {
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
  const effectiveVocalVolume = vocalMuted ? 0 : mixSettings.vocalVolume;

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
      pausePreview();
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




  return (
    <div className="min-h-screen bg-[#131315] text-[#fafafa] font-sans flex overflow-hidden">
      
      {/* LEFT SIDEBAR */}
      <aside className="w-64 bg-[#1b1b1d] border-r border-[#27272a] hidden md:flex flex-col">
        <div className="h-12 border-b border-[#27272a] flex items-center px-4">
          <h1 className="text-xs font-bold tracking-widest uppercase">Pro Audio</h1>
        </div>
        <nav className="flex-1 p-4 space-y-6">
          <div>
            <h2 className="text-[10px] font-mono text-[#a1a1aa] mb-3 uppercase tracking-wider">Library</h2>
            <ul className="space-y-1">
              <li>
                <button className="w-full text-left px-2 py-1.5 rounded text-xs bg-[#3b82f6] text-white">Current Session</button>
              </li>
              <li>
                <button className="w-full text-left px-2 py-1.5 rounded text-xs text-[#a1a1aa] hover:bg-[#201f21] hover:text-white transition-colors">Vocal Takes</button>
              </li>
              <li>
                <button className="w-full text-left px-2 py-1.5 rounded text-xs text-[#a1a1aa] hover:bg-[#201f21] hover:text-white transition-colors">Exported Mixes</button>
              </li>
            </ul>
          </div>
          <div>
            <h2 className="text-[10px] font-mono text-[#a1a1aa] mb-3 uppercase tracking-wider">Settings</h2>
            <ul className="space-y-1">
              <li>
                <button className="w-full text-left px-2 py-1.5 rounded text-xs text-[#a1a1aa] hover:bg-[#201f21] hover:text-white transition-colors">Audio Interface</button>
              </li>
              <li>
                <button className="w-full text-left px-2 py-1.5 rounded text-xs text-[#a1a1aa] hover:bg-[#201f21] hover:text-white transition-colors">Shortcuts</button>
              </li>
            </ul>
          </div>
        </nav>
      </aside>

      {/* MAIN STAGE */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        
        {/* TRANSPORT HEADER */}
        <header className="h-16 flex items-center justify-between border-b border-[#27272a] bg-[#1b1b1d] px-6">
          <div className="flex items-center gap-6">
            
            {/* Unified Transport Controls */}
            <div className="flex items-center gap-3">
              
              {/* Record Button */}
              <button 
                onClick={handleStartRecording}
                disabled={isRecording || isPlaying || !trackFile}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                  isRecording 
                    ? 'bg-[#ef4444] text-white shadow-[0_0_15px_rgba(239,68,68,0.6)] animate-pulse' 
                    : 'bg-[#121214] border border-[#ef4444] text-[#ef4444] hover:bg-[#ef4444] hover:text-white disabled:opacity-50 disabled:pointer-events-none'
                }`}
                title="Record"
              >
                <div className="w-3 h-3 rounded-full bg-current" />
              </button>

              {/* Stop Button */}
              <button 
                onClick={handleStopClick}
                disabled={!isRecording && !isPlaying && currentTime === 0}
                className="w-10 h-10 rounded bg-[#121214] border border-[#a1a1aa] text-[#a1a1aa] hover:bg-[#a1a1aa] hover:text-white flex items-center justify-center transition-colors disabled:opacity-50 disabled:pointer-events-none"
                title="Stop"
              >
                <Square className="w-4 h-4 fill-current" />
              </button>

            </div>
          </div>

          <div className="flex items-center gap-4">
            <button 
              onClick={handleExportClick}
              disabled={isProcessing || !recordedBlob}
              className="flex items-center space-x-2 bg-white text-black hover:bg-gray-200 px-4 py-2 rounded text-xs font-bold transition-all disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span>{isProcessing ? 'Rendering...' : 'Bounce Mix'}</span>
            </button>
          </div>
        </header>

        {/* TIMELINE AREA */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-[#121214]">
          
          {/* TRACK 1: BACKING TRACK */}
          <div className="flex h-32 border border-[#27272a] bg-[#1b1b1d] rounded overflow-hidden">
            <div className="w-64 p-4 flex flex-col justify-between border-r border-[#27272a] shrink-0">
              <div className="flex-1">
                <div className="flex justify-between items-start mb-1">
                  <div className="flex items-center gap-2 overflow-hidden pr-2">
                    <span className="font-bold text-xs text-white truncate">Track 1: Backing Track</span>
                    {trackBuffer && <span className="text-[10px] font-mono text-[#3b82f6] bg-[#121214] px-1.5 py-0.5 rounded whitespace-nowrap">{formatTime(currentTime)} / {formatTime(trackBuffer.duration)}</span>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {trackBuffer && (
                      <button 
                        onClick={handlePlayPauseClick} 
                        className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                          (isPlaying) || (isRecording && !isRecPaused)
                            ? 'bg-[#10b981] border-[#10b981] text-white shadow-[0_0_8px_rgba(16,185,129,0.4)]'
                            : 'bg-[#121214] border-[#10b981] text-[#10b981] hover:bg-[#10b981] hover:text-white'
                        }`}
                        title="Play/Pause Mix"
                      >
                        {(isPlaying) || (isRecording && !isRecPaused) ? <Pause className="w-2.5 h-2.5 fill-current" /> : <Play className="w-2.5 h-2.5 fill-current ml-0.5" />}
                      </button>
                    )}
                    <button 
                      onClick={() => setTrackMuted(!trackMuted)}
                      className={`w-5 h-5 rounded border text-[10px] font-bold transition-colors ${trackMuted ? 'bg-[#3b82f6] border-[#3b82f6] text-white' : 'bg-[#121214] border-[#424754] text-[#a1a1aa] hover:border-[#3b82f6]'}`}
                    >
                      M
                    </button>
                  </div>
                </div>
                {trackFile && <span className="text-[10px] text-[#a1a1aa] font-mono truncate block">{trackFile.name}</span>}
              </div>
              
              <div className="flex items-center gap-2">
                <Volume2 className={`w-3 h-3 ${trackMuted ? 'text-[#424754]' : 'text-[#a1a1aa]'}`} />
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
                  className={`flex-1 h-1 rounded outline-none appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-sm transition-opacity ${trackMuted ? 'bg-[#121214] opacity-50 [&::-webkit-slider-thumb]:bg-[#424754]' : 'bg-[#121214] [&::-webkit-slider-thumb]:bg-[#3b82f6]'}`}
                />
                <span className={`text-[10px] font-mono w-6 text-right ${trackMuted ? 'text-[#424754]' : 'text-[#a1a1aa]'}`}>{mixSettings.trackVolume}</span>
              </div>
            </div>
            
            <div className={`flex-1 relative bg-[#121214] transition-opacity ${trackMuted ? 'opacity-30' : 'opacity-100'}`}>
              {trackBuffer ? (
                <StaticWaveform 
                  buffer={trackBuffer} 
                  color="#4b5563" 
                  duration={trackBuffer.duration} 
                  currentTime={currentTime} 
                  totalDuration={masterDuration}
                  onSeekStart={handleSeekStart} onSeekDrag={handleSeekDrag} onSeekEnd={handleSeekEnd}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <button 
                    onClick={() => document.getElementById('file-upload')?.click()}
                    className="border border-dashed border-[#424754] px-6 py-2 rounded text-xs font-medium text-[#a1a1aa] hover:bg-[#201f21] hover:text-white transition-colors"
                  >
                    Click to Load Backing Track
                  </button>
                  <input id="file-upload" type="file" accept="audio/*" onChange={handleTrackUpload} className="hidden" />
                </div>
              )}
            </div>
          </div>

          {/* TRACK 2: VOCALS */}
          <div className="flex h-32 border border-[#27272a] bg-[#1b1b1d] rounded overflow-hidden">
            <div className="w-64 p-4 flex flex-col justify-between border-r border-[#27272a] shrink-0">
              <div className="flex-1">
                <div className="flex justify-between items-start mb-1">
                  <div className="flex items-center gap-2 overflow-hidden pr-2">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isRecording ? 'bg-[#ef4444] animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]' : 'bg-[#424754]'}`} />
                    <span className="font-bold text-xs text-white truncate">Track 2: Your Vocals</span>
                    {vocalBuffer && <span className="text-[10px] font-mono text-[#ef4444] bg-[#121214] px-1.5 py-0.5 rounded whitespace-nowrap">{formatTime(currentTime)} / {formatTime(vocalBuffer.duration)}</span>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {vocalBuffer && (
                      <button 
                        onClick={handlePlayPauseClick} 
                        className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                          (isPlaying) || (isRecording && !isRecPaused)
                            ? 'bg-[#10b981] border-[#10b981] text-white shadow-[0_0_8px_rgba(16,185,129,0.4)]'
                            : 'bg-[#121214] border-[#10b981] text-[#10b981] hover:bg-[#10b981] hover:text-white'
                        }`}
                        title="Play/Pause Mix"
                      >
                        {(isPlaying) || (isRecording && !isRecPaused) ? <Pause className="w-2.5 h-2.5 fill-current" /> : <Play className="w-2.5 h-2.5 fill-current ml-0.5" />}
                      </button>
                    )}
                    <button 
                      onClick={() => setVocalMuted(!vocalMuted)}
                      className={`w-5 h-5 rounded border text-[10px] font-bold transition-colors ${vocalMuted ? 'bg-[#3b82f6] border-[#3b82f6] text-white' : 'bg-[#121214] border-[#424754] text-[#a1a1aa] hover:border-[#3b82f6]'}`}
                    >
                      M
                    </button>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <Mic2 className={`w-3 h-3 ${vocalMuted ? 'text-[#424754]' : 'text-[#a1a1aa]'}`} />
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
                  className={`flex-1 h-1 rounded outline-none appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-sm transition-opacity ${vocalMuted ? 'bg-[#121214] opacity-50 [&::-webkit-slider-thumb]:bg-[#424754]' : 'bg-[#121214] [&::-webkit-slider-thumb]:bg-[#ef4444]'}`}
                />
                <span className={`text-[10px] font-mono w-6 text-right ${vocalMuted ? 'text-[#424754]' : 'text-[#a1a1aa]'}`}>{mixSettings.vocalVolume}</span>
              </div>
            </div>
            
            <div className={`flex-1 relative bg-[#121214] transition-opacity ${vocalMuted ? 'opacity-30' : 'opacity-100'}`}>
              {isRecording ? (
                <div className="absolute inset-0">
                  <canvas ref={canvasRef} className="w-full h-full" />
                </div>
              ) : vocalBuffer ? (
                <StaticWaveform 
                  buffer={vocalBuffer} 
                  color="#fca5a5" 
                  duration={vocalBuffer.duration} 
                  currentTime={currentTime}
                  totalDuration={masterDuration}
                  onSeekStart={handleSeekStart} onSeekDrag={handleSeekDrag} onSeekEnd={handleSeekEnd}
                />
              ) : (
                <StaticWaveform 
                  buffer={null} 
                  color="#fca5a5" 
                  duration={0} 
                  currentTime={currentTime}
                  totalDuration={masterDuration}
                  onSeekStart={handleSeekStart} onSeekDrag={handleSeekDrag} onSeekEnd={handleSeekEnd}
                  emptyText="No Vocal Data"
                />
              )}
            </div>
          </div>

          {/* MASTER BUS SETTINGS (Docked at bottom) */}
          <div className="mt-8 p-4 bg-[#1b1b1d] border border-[#27272a] rounded flex gap-8">
            <div className="flex-1 max-w-sm">
              <h3 className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-wider mb-4">DSP Timing</h3>
              <div className="flex items-center gap-4">
                <span className="text-xs text-[#a1a1aa] w-20">Sync Offset</span>
                <input 
                  type="range" min="-300" max="300" 
                  value={mixSettings.latencyOffsetMs}
                  onChange={(e) => updateSetting('latencyOffsetMs', Number(e.target.value))}
                  className="flex-1 h-1 bg-[#121214] rounded outline-none appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-[#10b981] [&::-webkit-slider-thumb]:rounded-sm"
                />
                <span className="text-xs font-mono text-[#a1a1aa] w-12 text-right">{mixSettings.latencyOffsetMs}ms</span>
              </div>
              <span className="text-xs font-medium text-[#a1a1aa] mt-2 block">
                Nudge timing to fix bluetooth delay
              </span>
            </div>
            
            <div className="flex-1 max-w-sm border-l border-[#27272a] pl-8">
              <h3 className="text-[10px] font-bold text-[#a1a1aa] uppercase tracking-wider mb-4">Master Effects</h3>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#a1a1aa]">Studio Reverb (Vocals)</span>
                <button 
                  onClick={() => updateSetting('reverbEnabled', !mixSettings.reverbEnabled)}
                  className={`w-10 h-5 rounded transition-colors relative border ${mixSettings.reverbEnabled ? 'bg-[#3b82f6] border-[#3b82f6]' : 'bg-[#121214] border-[#424754]'}`}
                >
                  <div className={`absolute top-0.5 left-0.5 w-4 h-3.5 rounded-sm bg-white transition-transform ${mixSettings.reverbEnabled ? 'translate-x-4.5' : ''}`} />
                </button>
              </div>
            </div>
          </div>
        </div>
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
