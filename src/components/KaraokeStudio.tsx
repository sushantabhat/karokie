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

  const isReadyToRecord = trackFile && headphonesConfirmed;

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        
        <header className="text-center space-y-2">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-400 to-pink-600 text-transparent bg-clip-text">
            Karaoke Studio
          </h1>
          <p className="text-gray-400">Record, mix, and export your next hit entirely in the browser.</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* TRACK UPLOAD PANEL */}
          <div className="bg-gray-900 rounded-xl p-8 space-y-6 flex flex-col">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span className="bg-gray-800 w-8 h-8 rounded-full flex items-center justify-center text-sm">1</span>
              Backing Track
            </h2>
            
            {!trackFile ? (
              <div 
                onClick={() => document.getElementById('file-upload')?.click()}
                className="flex-1 border-2 border-dashed border-gray-700 rounded-xl p-8 text-center hover:bg-gray-800 transition-colors cursor-pointer flex flex-col justify-center items-center"
              >
                <input 
                  id="file-upload"
                  type="file" 
                  accept="audio/*" 
                  onChange={handleTrackUpload}
                  className="hidden"
                />
                <Upload className="w-10 h-10 mb-3 text-gray-500" />
                <h3 className="font-medium">Upload Audio</h3>
                <p className="text-sm text-gray-500 mt-1">MP3, WAV, AAC</p>
              </div>
            ) : (
              <div className="flex-1 bg-gray-800 rounded-xl p-6 flex flex-col justify-center items-center text-center space-y-4 border border-green-500/30">
                <CheckCircle2 className="w-12 h-12 text-green-500" />
                <div>
                  <h3 className="font-medium">{trackFile.name}</h3>
                  <p className="text-sm text-gray-400 mt-1">Track loaded and ready</p>
                </div>
                <button 
                  onClick={() => {
                    setTrackFile(null);
                    setHeadphonesConfirmed(false);
                  }}
                  className="text-sm text-gray-400 hover:text-white underline"
                >
                  Change Track
                </button>
              </div>
            )}
          </div>

          {/* HEADPHONES & RECORD PANEL */}
          <div className={`bg-gray-900 rounded-xl p-8 space-y-6 flex flex-col transition-opacity duration-300 ${!trackFile ? 'opacity-50 pointer-events-none' : ''}`}>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span className="bg-gray-800 w-8 h-8 rounded-full flex items-center justify-center text-sm">2</span>
              Vocals
            </h2>

            {!headphonesConfirmed ? (
              <div className="flex-1 bg-gray-800 rounded-xl p-6 text-center space-y-4 flex flex-col justify-center items-center">
                <Headphones className="w-10 h-10 text-yellow-500" />
                <p className="text-sm text-gray-400">Please wear headphones to prevent microphone feedback.</p>
                <button 
                  onClick={() => setHeadphonesConfirmed(true)}
                  className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  Headphones Connected
                </button>
              </div>
            ) : (
              <div className="flex-1 bg-gray-800 rounded-xl p-6 flex flex-col justify-center items-center space-y-6 border border-purple-500/30">
                {countdown !== null ? (
                  <div className="text-6xl font-bold text-purple-500 animate-pulse">
                    {countdown || 'GO!'}
                  </div>
                ) : (
                  <>
                    <canvas 
                      ref={canvasRef} 
                      className="w-full h-16 bg-black rounded-lg" 
                      width={400} 
                      height={64}
                    />
                    {!isRecording ? (
                      <button 
                        onClick={handleStartRecording}
                        className="bg-red-500 hover:bg-red-600 text-white w-16 h-16 rounded-full flex items-center justify-center transition-transform hover:scale-105"
                      >
                        <Mic className="w-6 h-6" />
                      </button>
                    ) : (
                      <button 
                        onClick={handleStopRecording}
                        className="bg-gray-900 border-2 border-red-500 text-white w-16 h-16 rounded-full flex items-center justify-center transition-transform hover:scale-105 animate-pulse"
                      >
                        <Square className="w-5 h-5 text-red-500 fill-current" />
                      </button>
                    )}
                    <p className="text-sm text-gray-400">
                      {isRecording ? 'Recording...' : recordedBlob ? 'Ready to re-record' : 'Click to start'}
                    </p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* MIX & EXPORT PANEL */}
        <div className={`bg-gray-900 rounded-xl p-8 space-y-8 transition-opacity duration-300 ${!recordedBlob ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <span className="bg-gray-800 w-8 h-8 rounded-full flex items-center justify-center text-sm">3</span>
              Mix & Export
            </h2>
            <div className="flex items-center space-x-4">
              <button 
                onClick={handlePlayPreview}
                className="flex items-center space-x-2 bg-purple-600 hover:bg-purple-700 px-6 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                {isPlaying && !isPaused ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                <span>{isPlaying && !isPaused ? 'Pause' : isPlaying && isPaused ? 'Resume' : 'Play Preview'}</span>
              </button>
              {isPlaying && (
                <button 
                  onClick={stopPreview}
                  className="flex items-center space-x-2 bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  <Square className="w-4 h-4" />
                  <span>Stop</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6 p-6 bg-gray-800 rounded-lg">
              <div className="flex items-center space-x-2 mb-4 text-purple-400">
                <Settings2 className="w-5 h-5" />
                <h3 className="font-medium">Volume</h3>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Backing Track</span>
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
                  className="w-full accent-purple-500"
                />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Vocals</span>
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
                  className="w-full accent-purple-500"
                />
              </div>
            </div>

            <div className="space-y-6 p-6 bg-gray-800 rounded-lg">
              <div className="flex items-center space-x-2 mb-4 text-pink-400">
                <Settings2 className="w-5 h-5" />
                <h3 className="font-medium">Effects</h3>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Latency Offset</span>
                  <span>{mixSettings.latencyOffsetMs}ms</span>
                </div>
                <input 
                  type="range" min="-300" max="300" 
                  value={mixSettings.latencyOffsetMs}
                  onChange={(e) => updateSetting('latencyOffsetMs', Number(e.target.value))}
                  className="w-full accent-pink-500"
                />
              </div>
              <div className="flex items-center justify-between pt-4">
                <span>Studio Reverb</span>
                <button 
                  onClick={() => updateSetting('reverbEnabled', !mixSettings.reverbEnabled)}
                  className={`w-12 h-6 rounded-full transition-colors relative ${mixSettings.reverbEnabled ? 'bg-pink-500' : 'bg-gray-600'}`}
                >
                  <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${mixSettings.reverbEnabled ? 'translate-x-6' : ''}`} />
                </button>
              </div>
            </div>
          </div>

          <div className="pt-4 flex justify-end border-t border-gray-800">
            <button 
              onClick={handleExport}
              disabled={isProcessing}
              className="flex items-center space-x-2 bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 px-8 py-3 rounded-lg font-bold transition-all transform hover:scale-105 disabled:opacity-50 disabled:scale-100"
            >
              <Download className="w-5 h-5" />
              <span>{isProcessing ? 'Processing...' : 'Export Mix'}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
