'use client';

import { useState, useRef, useEffect } from 'react';
import { Upload, Headphones, Mic, Play, Pause, Square, Settings2, Download, CheckCircle2 } from 'lucide-react';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { useAudioMixer, MixSettings } from '@/hooks/useAudioMixer';

export default function KaraokeStudio() {
  const [trackFile, setTrackFile] = useState<File | null>(null);
  const [headphonesConfirmed, setHeadphonesConfirmed] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  
  const { isRecording, recordedBlob, startRecording, stopRecording, resetRecording } = useAudioRecorder();
  const { 
    loadTrack, loadVocal, playPreview, stopPreview, pausePreview, resumePreview, exportMix, 
    isPlaying, isPaused, isProcessing, setTrackVolumeLive, setVocalVolumeLive 
  } = useAudioMixer();

  const [mixSettings, setMixSettings] = useState<MixSettings>({
    trackVolume: 80,
    vocalVolume: 100,
    latencyOffsetMs: 0,
    reverbEnabled: false,
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleTrackUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setTrackFile(file);
      await loadTrack(file);
    }
  };

  const handleStartRecording = () => {
    if (trackFile && !audioRef.current) {
      audioRef.current = new Audio(URL.createObjectURL(trackFile));
    }
    
    if (audioRef.current) {
      audioRef.current.muted = true;
      audioRef.current.play().then(() => {
        audioRef.current?.pause();
        if (audioRef.current) {
          audioRef.current.currentTime = 0;
          audioRef.current.muted = false;
        }
      }).catch(e => console.error("Audio unlock failed", e));
    }

    setCountdown(3);
  };

  useEffect(() => {
    if (countdown === null) return;
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      setCountdown(null);
      startRecording();
      if (audioRef.current) {
        audioRef.current.play();
      }
    }
  }, [countdown, startRecording]);

  const handleStopRecording = () => {
    stopRecording();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  useEffect(() => {
    if (recordedBlob) {
      loadVocal(recordedBlob);
    }
  }, [recordedBlob, loadVocal]);

  const handleExport = async () => {
    const mixedBlob = await exportMix(mixSettings);
    if (mixedBlob) {
      const url = URL.createObjectURL(mixedBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'karaoke-mix.wav';
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handlePlayPreview = () => {
    if (isPlaying) {
      if (isPaused) {
        resumePreview();
      } else {
        pausePreview();
      }
    } else {
      playPreview(mixSettings);
    }
  };

  const updateSetting = <K extends keyof MixSettings>(key: K, value: MixSettings[K]) => {
    setMixSettings(prev => ({ ...prev, [key]: value }));
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
      <div className="flex-1 flex flex-col h-screen overflow-y-auto p-8">
        <div className="max-w-5xl mx-auto w-full space-y-6">
          
          <header className="flex flex-col md:flex-row md:items-center justify-between border-b border-[#27272a] pb-6 mb-8">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Karaoke Studio</h1>
              <p className="text-sm text-[#a1a1aa] mt-1">Browser-based multi-track recording environment</p>
            </div>
            <div className="mt-4 md:mt-0 flex gap-4">
              <div className="flex items-center gap-2 text-xs font-mono text-[#a1a1aa]">
                <div className="w-2 h-2 rounded-full bg-[#10b981]"></div> System Ready
              </div>
            </div>
          </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* TRACK UPLOAD PANEL */}
          <div className="bg-[#1b1b1d] border border-[#27272a] rounded p-6 space-y-4 flex flex-col">
            <div className="flex items-center justify-between border-b border-[#27272a] pb-4">
              <h2 className="text-sm font-semibold tracking-wide uppercase text-[#a1a1aa]">Track 1: Instrumentals</h2>
            </div>
            
            {!trackFile ? (
              <div 
                onClick={() => document.getElementById('file-upload')?.click()}
                className="flex-1 border border-dashed border-[#424754] bg-[#201f21] rounded p-8 text-center hover:bg-[#2a2a2c] transition-colors cursor-pointer flex flex-col justify-center items-center"
              >
                <input 
                  id="file-upload"
                  type="file" 
                  accept="audio/*" 
                  onChange={handleTrackUpload}
                  className="hidden"
                />
                <Upload className="w-6 h-6 mb-3 text-[#a1a1aa]" />
                <h3 className="text-sm font-medium">Load Backing Track</h3>
                <p className="text-xs text-[#a1a1aa] mt-1 font-mono">MP3 / WAV / AAC</p>
              </div>
            ) : (
              <div className="flex-1 bg-[#201f21] border border-[#27272a] rounded p-6 flex flex-col justify-center items-center text-center space-y-4">
                <CheckCircle2 className="w-8 h-8 text-[#10b981]" />
                <div>
                  <h3 className="text-sm font-medium font-mono">{trackFile.name}</h3>
                  <p className="text-xs text-[#a1a1aa] mt-1">Track loaded and ready</p>
                </div>
                <button 
                  onClick={() => {
                    setTrackFile(null);
                    setHeadphonesConfirmed(false);
                    if (audioRef.current) {
                      audioRef.current.pause();
                      audioRef.current = null;
                    }
                  }}
                  className="text-xs text-[#3b82f6] hover:text-[#4d8eff] underline"
                >
                  Change Track
                </button>
              </div>
            )}
          </div>

          {/* HEADPHONES & RECORD PANEL */}
          <div className={`bg-[#1b1b1d] border border-[#27272a] rounded p-6 space-y-4 flex flex-col transition-opacity duration-300 ${!trackFile ? 'opacity-50 pointer-events-none' : ''}`}>
            <div className="flex items-center justify-between border-b border-[#27272a] pb-4">
              <h2 className="text-sm font-semibold tracking-wide uppercase text-[#a1a1aa]">Track 2: Vocals</h2>
              {isRecording && <div className="text-xs font-mono text-[#ef4444] animate-pulse flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-[#ef4444]"></div> REC</div>}
            </div>

            {!headphonesConfirmed ? (
              <div className="flex-1 bg-[#201f21] border border-[#27272a] rounded p-6 text-center space-y-4 flex flex-col justify-center items-center">
                <Headphones className="w-8 h-8 text-[#f59e0b]" />
                <p className="text-xs text-[#a1a1aa]">Monitor required. Please wear headphones to prevent feedback loops.</p>
                <button 
                  onClick={() => setHeadphonesConfirmed(true)}
                  className="bg-[#3b82f6] hover:bg-[#4d8eff] text-white px-4 py-2 rounded text-xs font-medium transition-colors"
                >
                  Confirm Monitor Active
                </button>
              </div>
            ) : (
              <div className="flex-1 bg-[#201f21] border border-[#27272a] rounded p-6 flex flex-col justify-center items-center space-y-6">
                {countdown !== null ? (
                  <div className="text-5xl font-mono font-bold text-[#3b82f6]">
                    {countdown || 'GO'}
                  </div>
                ) : (
                  <>
                    <canvas 
                      ref={canvasRef} 
                      className="w-full h-12 bg-[#121214] border border-[#27272a] rounded" 
                      width={400} 
                      height={48}
                    />
                    {!isRecording ? (
                      <button 
                        onClick={handleStartRecording}
                        className="bg-[#ef4444] hover:bg-[#dc2626] text-white w-12 h-12 rounded flex items-center justify-center transition-transform hover:scale-95"
                      >
                        <Mic className="w-5 h-5" />
                      </button>
                    ) : (
                      <button 
                        onClick={handleStopRecording}
                        className="bg-[#121214] border border-[#ef4444] text-[#ef4444] w-12 h-12 rounded flex items-center justify-center transition-transform hover:scale-95"
                      >
                        <Square className="w-4 h-4 fill-current" />
                      </button>
                    )}
                    <p className="text-xs font-mono text-[#a1a1aa]">
                      {isRecording ? 'Capturing Audio...' : recordedBlob ? 'Take Complete - Ready to Overwrite' : 'Arm Recording'}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* MIX & EXPORT PANEL */}
        <div className={`bg-[#1b1b1d] border border-[#27272a] rounded p-6 space-y-6 transition-opacity duration-300 ${!recordedBlob ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex items-center justify-between border-b border-[#27272a] pb-4">
            <h2 className="text-sm font-semibold tracking-wide uppercase text-[#a1a1aa]">Master Bus</h2>
            
            <div className="flex items-center space-x-2">
              <button 
                onClick={handlePlayPreview}
                className="flex items-center space-x-2 bg-[#3b82f6] hover:bg-[#4d8eff] px-4 py-1.5 rounded text-xs font-medium transition-colors"
              >
                {isPlaying && !isPaused ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span>{isPlaying && !isPaused ? 'Pause' : isPlaying && isPaused ? 'Resume' : 'Preview Mix'}</span>
              </button>
              {isPlaying && (
                <button 
                  onClick={stopPreview}
                  className="flex items-center space-x-2 bg-[#27272a] hover:bg-[#353437] px-4 py-1.5 rounded text-xs font-medium transition-colors"
                >
                  <Square className="w-3.5 h-3.5" />
                  <span>Stop</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Volume Mixers */}
            <div className="space-y-4 p-4 bg-[#201f21] border border-[#27272a] rounded">
              <div className="flex items-center space-x-2 mb-2 text-[#a1a1aa]">
                <Settings2 className="w-4 h-4" />
                <h3 className="text-xs font-medium uppercase tracking-wide">Faders</h3>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-mono text-[#a1a1aa]">
                  <span>Track 1</span>
                  <span>{mixSettings.trackVolume}%</span>
                </div>
                <input 
                  type="range" min="0" max="200" 
                  value={mixSettings.trackVolume}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    updateSetting('trackVolume', val);
                    if (isPlaying) setTrackVolumeLive(val);
                  }}
                  className="w-full h-1 bg-[#121214] rounded outline-none appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-[#3b82f6] [&::-webkit-slider-thumb]:rounded-sm"
                />
              </div>
              <div className="space-y-1 pt-2">
                <div className="flex justify-between text-xs font-mono text-[#a1a1aa]">
                  <span>Track 2</span>
                  <span>{mixSettings.vocalVolume}%</span>
                </div>
                <input 
                  type="range" min="0" max="200" 
                  value={mixSettings.vocalVolume}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    updateSetting('vocalVolume', val);
                    if (isPlaying) setVocalVolumeLive(val);
                  }}
                  className="w-full h-1 bg-[#121214] rounded outline-none appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-[#3b82f6] [&::-webkit-slider-thumb]:rounded-sm"
                />
              </div>
            </div>

            {/* Effects & DSP */}
            <div className="space-y-4 p-4 bg-[#201f21] border border-[#27272a] rounded">
              <div className="flex items-center space-x-2 mb-2 text-[#a1a1aa]">
                <Settings2 className="w-4 h-4" />
                <h3 className="text-xs font-medium uppercase tracking-wide">DSP & Timing</h3>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-mono text-[#a1a1aa]">
                  <span>Sync Offset</span>
                  <span>{mixSettings.latencyOffsetMs}ms</span>
                </div>
                <input 
                  type="range" min="-300" max="300" 
                  value={mixSettings.latencyOffsetMs}
                  onChange={(e) => updateSetting('latencyOffsetMs', Number(e.target.value))}
                  className="w-full h-1 bg-[#121214] rounded outline-none appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-[#10b981] [&::-webkit-slider-thumb]:rounded-sm"
                />
              </div>
              <div className="flex items-center justify-between pt-4">
                <span className="text-xs font-mono text-[#a1a1aa]">Studio Reverb</span>
                <button 
                  onClick={() => updateSetting('reverbEnabled', !mixSettings.reverbEnabled)}
                  className={`w-10 h-5 rounded transition-colors relative border ${mixSettings.reverbEnabled ? 'bg-[#3b82f6] border-[#3b82f6]' : 'bg-[#121214] border-[#424754]'}`}
                >
                  <div className={`absolute top-0.5 left-0.5 w-4 h-3.5 rounded-sm bg-white transition-transform ${mixSettings.reverbEnabled ? 'translate-x-4.5' : ''}`} />
                </button>
              </div>
            </div>
          </div>

          <div className="pt-4 flex justify-end">
            <button 
              onClick={handleExport}
              disabled={isProcessing}
              className="flex items-center space-x-2 bg-white text-black hover:bg-gray-200 px-6 py-2 rounded text-xs font-bold transition-all disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span>{isProcessing ? 'Rendering Audio...' : 'Bounce Mix (WAV)'}</span>
            </button>
          </div>
        </div>

        </div>
      </div>
    </div>
  );
}
