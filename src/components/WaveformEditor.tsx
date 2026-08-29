"use client";
import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js';
import { Play, Pause, ZoomIn, ZoomOut } from 'lucide-react';

export type LineSync = {
  id: string;
  text: string;
  start: number | null;
  end: number | null;
};

interface WaveformEditorProps {
  trackUrl: string;
  lyrics: LineSync[];
  onUpdateLine: (id: string, start: number, end: number) => void;
}

export default function WaveformEditor({ trackUrl, lyrics, onUpdateLine }: WaveformEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const wavesurfer = useRef<WaveSurfer | null>(null);
  const regions = useRef<RegionsPlugin | null>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoom, setZoom] = useState(50);
  const [isReady, setIsReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Initialize WaveSurfer
  useEffect(() => {
    if (!containerRef.current || !timelineRef.current) return;

    try {
      wavesurfer.current = WaveSurfer.create({
        container: containerRef.current,
        waveColor: '#3f3f46',
        progressColor: '#38bdf8',
        cursorColor: '#fb7185',
        cursorWidth: 2,
        height: 180,
        normalize: true,
        minPxPerSec: zoom,
      });

      regions.current = wavesurfer.current.registerPlugin(RegionsPlugin.create());
      wavesurfer.current.registerPlugin(TimelinePlugin.create({
        container: timelineRef.current,
        height: 20,
        timeInterval: 5,
        primaryLabelInterval: 10,
        style: {
          fontSize: '10px',
          color: '#71717a',
        },
      }));

      if (trackUrl) {
        wavesurfer.current.load(trackUrl).catch((err: any) => {
          if (err && err.name !== 'AbortError') {
             console.error('WaveSurfer load error:', err);
             setErrorMsg(err?.message || String(err));
          }
        });
      }

      wavesurfer.current.on('ready', () => {
        setIsReady(true);
      });

      wavesurfer.current.on('play', () => setIsPlaying(true));
      wavesurfer.current.on('pause', () => setIsPlaying(false));
      wavesurfer.current.on('error', (err: any) => {
        console.error('WaveSurfer error:', err);
        setErrorMsg(err?.message || String(err));
      });
    } catch (err: any) {
      console.error('Init error:', err);
      setErrorMsg(err?.message || String(err));
    }

    return () => {
      try {
        wavesurfer.current?.destroy();
      } catch (err) {}
    };
  }, [trackUrl]);

  // Update Zoom
  useEffect(() => {
    if (wavesurfer.current && isReady) {
      wavesurfer.current.zoom(zoom);
    }
  }, [zoom, isReady]);

  // Sync Regions with Lyrics state
  useEffect(() => {
    if (!isReady || !regions.current) return;

    const existingRegions = regions.current.getRegions();
    const currentLineIds = new Set(lyrics.map(l => `line-${l.id}`));

    // Remove deleted regions
    existingRegions.forEach(r => {
      if (r.id.startsWith('line-') && !currentLineIds.has(r.id)) {
        r.remove();
      }
    });

    lyrics.forEach((line, i) => {
      const fallbackStart = i * 4;
      const fallbackEnd = fallbackStart + 3.5;
      const wStart = line.start !== null ? line.start : fallbackStart;
      const wEnd = line.end !== null ? line.end : fallbackEnd;

      const regionId = `line-${line.id}`;
      const existing = existingRegions.find(r => r.id === regionId);

      if (existing) {
        // Update if significantly different (avoids interrupting active drags)
        if (Math.abs(existing.start - wStart) > 0.05 || Math.abs(existing.end - wEnd) > 0.05) {
          existing.setOptions({ start: wStart, end: wEnd });
        }
      } else {
        const contentEl = document.createElement('div');
        contentEl.innerText = line.text;
        contentEl.style.cssText = 'color: #fff; font-size: 14px; font-weight: bold; text-shadow: 0 1px 3px rgba(0,0,0,0.9); padding: 4px; pointer-events: none; text-align: center; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden;';

        regions.current!.addRegion({
          start: wStart,
          end: wEnd,
          content: contentEl,
          color: 'rgba(56, 189, 248, 0.15)',
          drag: true,
          resize: true,
          id: regionId
        });
      }
    });
  }, [isReady, lyrics]);

  // Bind events exactly once when ready
  useEffect(() => {
    if (!isReady || !regions.current) return;
    
    // We use region-update instead of region-updated for real-time collision pushing!
    const onRegionUpdate = (region: any) => {
      if (region.id.startsWith('line-')) {
        const id = region.id.replace('line-', '');
        onUpdateLine(id, region.start, region.end);
      }
    };

    regions.current.on('region-update', onRegionUpdate);

    return () => {
      regions.current?.un('region-update', onRegionUpdate);
    };
  }, [isReady]); // We rely on onUpdateLine being stable or using refs if necessary


  const togglePlay = () => {
    wavesurfer.current?.playPause();
  };

  return (
    <div className="flex flex-col h-full border border-[#1f222b] bg-[#16181f] rounded-lg shadow-sm">
      {errorMsg && (
        <div className="bg-red-500/20 text-red-400 p-2 text-xs font-mono border-b border-red-500/50">
          Error: {errorMsg}
        </div>
      )}
      <div className="p-3 border-b border-[#1f222b] flex items-center justify-between shrink-0">
        <h3 className="font-bold text-white flex items-center gap-2 text-sm">
          <span className="text-[#38bdf8]">Global Timeline</span> (CapCut Style)
        </h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <button onClick={() => setZoom(z => Math.max(10, z - 20))} className="p-1.5 text-[#a1a1aa] hover:text-white rounded hover:bg-[#1f222b]">
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono text-[#71717a] w-12 text-center">{zoom}px</span>
            <button onClick={() => setZoom(z => Math.min(300, z + 20))} className="p-1.5 text-[#a1a1aa] hover:text-white rounded hover:bg-[#1f222b]">
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>
          <div className="h-4 w-px bg-[#1f222b]" />
          <button onClick={togglePlay} className="w-8 h-8 flex items-center justify-center bg-[#38bdf8] text-gray-900 rounded-full hover:bg-[#0ea5e9] transition-colors">
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>
        </div>
      </div>
      
      <div className="flex-1 p-4 overflow-hidden flex flex-col relative">
        {/* Timeline */}
        <div ref={timelineRef} className="w-full h-[20px] shrink-0 mb-1 opacity-50" />
        
        {/* Waveform */}
        <div 
          ref={containerRef} 
          className="w-full flex-1 rounded bg-[#0d0e12] border border-[#1f222b] custom-scrollbar overflow-y-auto"
        />
      </div>
    </div>
  );
}
