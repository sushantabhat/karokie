'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { audioBufferToWav } from '@/utils/audioBufferToWav';

export interface MixSettings {
  trackVolume: number;
  vocalVolume: number;
  latencyOffsetMs: number;
  reverbEnabled: boolean;
}

export function useAudioMixer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  
  // Buffers
  const trackBufferRef = useRef<AudioBuffer | null>(null);
  const vocalBufferRef = useRef<AudioBuffer | null>(null);
  const reverbBufferRef = useRef<AudioBuffer | null>(null);

  // Nodes for live playback
  const trackSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const vocalSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const trackGainRef = useRef<GainNode | null>(null);
  const vocalGainRef = useRef<GainNode | null>(null);
  
  const [isProcessing, setIsProcessing] = useState(false);

  // Initialize AudioContext
  useEffect(() => {
    audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Generate a simple impulse response for reverb
    const generateReverb = async () => {
      if (!audioContextRef.current) return;
      const sampleRate = audioContextRef.current.sampleRate;
      const length = sampleRate * 2; // 2 seconds reverb
      const impulse = audioContextRef.current.createBuffer(2, length, sampleRate);
      const impulseL = impulse.getChannelData(0);
      const impulseR = impulse.getChannelData(1);
      
      for (let i = 0; i < length; i++) {
        const decay = Math.exp(-i / (sampleRate * 0.5));
        impulseL[i] = (Math.random() * 2 - 1) * decay;
        impulseR[i] = (Math.random() * 2 - 1) * decay;
      }
      reverbBufferRef.current = impulse;
    };
    
    generateReverb();

    return () => {
      if (audioContextRef.current?.state !== 'closed') {
        audioContextRef.current?.close();
      }
    };
  }, []);

  const loadTrack = useCallback(async (file: File) => {
    if (!audioContextRef.current) return null;
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
    trackBufferRef.current = audioBuffer;
    return audioBuffer;
  }, []);

  const loadVocal = useCallback(async (blob: Blob) => {
    if (!audioContextRef.current) return null;
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
    vocalBufferRef.current = audioBuffer;
    return audioBuffer;
  }, []);

  const stopPreview = useCallback(() => {
    if (trackSourceRef.current) {
      try { trackSourceRef.current.stop(); } catch (e) {}
    }
    if (vocalSourceRef.current) {
      try { vocalSourceRef.current.stop(); } catch (e) {}
    }
    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume();
    }
    setIsPlaying(false);
    setIsPaused(false);
  }, []);

  const playPreview = useCallback(async (settings: MixSettings) => {
    if (!audioContextRef.current || !trackBufferRef.current || !vocalBufferRef.current) return;
    
    stopPreview(); // Stop existing

    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    
    // Track setup
    trackSourceRef.current = ctx.createBufferSource();
    trackSourceRef.current.buffer = trackBufferRef.current;
    trackGainRef.current = ctx.createGain();
    trackGainRef.current.gain.value = settings.trackVolume / 100;
    trackSourceRef.current.connect(trackGainRef.current);
    trackGainRef.current.connect(ctx.destination);

    // Vocal setup
    vocalSourceRef.current = ctx.createBufferSource();
    vocalSourceRef.current.buffer = vocalBufferRef.current;
    vocalGainRef.current = ctx.createGain();
    vocalGainRef.current.gain.value = settings.vocalVolume / 100;
    
    // Effects chain
    if (settings.reverbEnabled && reverbBufferRef.current) {
      const convolver = ctx.createConvolver();
      convolver.buffer = reverbBufferRef.current;
      
      const wetGain = ctx.createGain();
      const dryGain = ctx.createGain();
      
      wetGain.gain.value = 0.3;
      dryGain.gain.value = 0.7;

      vocalSourceRef.current.connect(dryGain);
      dryGain.connect(vocalGainRef.current);

      vocalSourceRef.current.connect(convolver);
      convolver.connect(wetGain);
      wetGain.connect(vocalGainRef.current);
    } else {
      vocalSourceRef.current.connect(vocalGainRef.current);
    }
    
    vocalGainRef.current.connect(ctx.destination);

    // Sync with latency offset (offset is in ms, we need seconds)
    const offsetSeconds = settings.latencyOffsetMs / 1000;
    
    const startTime = ctx.currentTime + 0.1;
    
    if (offsetSeconds >= 0) {
      // Delay vocals
      trackSourceRef.current.start(startTime);
      vocalSourceRef.current.start(startTime + offsetSeconds);
    } else {
      // Delay track
      trackSourceRef.current.start(startTime + Math.abs(offsetSeconds));
      vocalSourceRef.current.start(startTime);
    }
    
    setIsPlaying(true);
    
    trackSourceRef.current.onended = () => setIsPlaying(false);
  }, [stopPreview]);

  const pausePreview = useCallback(() => {
    if (audioContextRef.current && isPlaying) {
      audioContextRef.current.suspend();
      setIsPaused(true);
    }
  }, [isPlaying]);

  const resumePreview = useCallback(() => {
    if (audioContextRef.current && isPaused) {
      audioContextRef.current.resume();
      setIsPaused(false);
    }
  }, [isPaused]);

  // Real-time volume updates
  const setTrackVolumeLive = useCallback((volume: number) => {
    if (trackGainRef.current && audioContextRef.current) {
      trackGainRef.current.gain.setTargetAtTime(volume / 100, audioContextRef.current.currentTime, 0.05);
    }
  }, []);

  const setVocalVolumeLive = useCallback((volume: number) => {
    if (vocalGainRef.current && audioContextRef.current) {
      vocalGainRef.current.gain.setTargetAtTime(volume / 100, audioContextRef.current.currentTime, 0.05);
    }
  }, []);

  const exportMix = useCallback(async (settings: MixSettings): Promise<Blob | null> => {
    if (!trackBufferRef.current || !vocalBufferRef.current) return null;
    setIsProcessing(true);
    
    try {
      const sampleRate = trackBufferRef.current.sampleRate;
      
      // Trim the export to end exactly when the vocal recording ends
      const vocalDuration = vocalBufferRef.current.duration;
      const lengthSeconds = vocalDuration + (settings.latencyOffsetMs > 0 ? settings.latencyOffsetMs / 1000 : 0);
      
      const offlineCtx = new OfflineAudioContext(
        2, 
        Math.ceil(sampleRate * lengthSeconds), 
        sampleRate
      );

      // Track Setup
      const trackSource = offlineCtx.createBufferSource();
      trackSource.buffer = trackBufferRef.current;
      const trackGain = offlineCtx.createGain();
      trackGain.gain.value = settings.trackVolume / 100;
      trackSource.connect(trackGain);
      trackGain.connect(offlineCtx.destination);

      // Vocal Setup
      const vocalSource = offlineCtx.createBufferSource();
      vocalSource.buffer = vocalBufferRef.current;
      const vocalGain = offlineCtx.createGain();
      vocalGain.gain.value = settings.vocalVolume / 100;
      
      if (settings.reverbEnabled && reverbBufferRef.current) {
        const convolver = offlineCtx.createConvolver();
        convolver.buffer = reverbBufferRef.current;
        const wetGain = offlineCtx.createGain();
        const dryGain = offlineCtx.createGain();
        wetGain.gain.value = 0.3;
        dryGain.gain.value = 0.7;
        vocalSource.connect(dryGain);
        dryGain.connect(vocalGain);
        vocalSource.connect(convolver);
        convolver.connect(wetGain);
        wetGain.connect(vocalGain);
      } else {
        vocalSource.connect(vocalGain);
      }
      vocalGain.connect(offlineCtx.destination);

      const offsetSeconds = settings.latencyOffsetMs / 1000;
      if (offsetSeconds >= 0) {
        trackSource.start(0);
        vocalSource.start(offsetSeconds);
      } else {
        trackSource.start(Math.abs(offsetSeconds));
        vocalSource.start(0);
      }

      const renderedBuffer = await offlineCtx.startRendering();
      const wavBlob = audioBufferToWav(renderedBuffer);
      return wavBlob;
    } catch (err) {
      console.error('Export failed', err);
      return null;
    } finally {
      setIsProcessing(false);
    }
  }, []);

  return {
    loadTrack,
    loadVocal,
    playPreview,
    stopPreview,
    pausePreview,
    resumePreview,
    exportMix,
    isPlaying,
    isPaused,
    isProcessing,
    setTrackVolumeLive,
    setVocalVolumeLive,
  };
}
