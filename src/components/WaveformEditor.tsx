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
  const wavesurfer = useRef<WaveSurfer | null>(null);
  const regions = useRef<RegionsPlugin | null>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [zoom, setZoom] = useState(50);
  const [isReady, setIsReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [hoveredInfo, setHoveredInfo] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const currentIndex = React.useMemo(() => {
    let idx = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (lyrics[i].start !== null && currentTime >= lyrics[i].start) {
        idx = i;
      }
    }
    return idx;
  }, [lyrics, currentTime]);

  const activeLyric = React.useMemo(() => {
    if (currentIndex === -1) return null;
    const line = lyrics[currentIndex];
    if (line.end !== null && currentTime > line.end) return null;
    return line;
  }, [currentIndex, lyrics, currentTime]);

  const focusIndex = currentIndex === -1 ? 0 : currentIndex;

  // Initialize WaveSurfer
  useEffect(() => {
    if (!containerRef.current) return;

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
        dragToSeek: true,
        interact: true,
      });

      regions.current = wavesurfer.current.registerPlugin(RegionsPlugin.create());
      wavesurfer.current.registerPlugin(TimelinePlugin.create({
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
        if (wavesurfer.current) {
          setDuration(wavesurfer.current.getDuration());
          
          // Forcefully inject handles directly into the Shadow DOM cursor element
          const shadowRoot = containerRef.current?.shadowRoot;
          if (shadowRoot) {
            const cursor = shadowRoot.querySelector('[part="cursor"]') as HTMLElement;
            if (cursor) {
              cursor.style.overflow = 'visible';
              cursor.style.zIndex = '9999';
              cursor.style.pointerEvents = 'auto';
              cursor.innerHTML = `
                <div style="position: absolute; top: -2px; left: 50%; transform: translateX(-50%); width: 14px; height: 14px; background-color: #fb7185; border: 2px solid #ffffff; border-radius: 50%; box-shadow: 0 2px 6px rgba(0,0,0,0.8); pointer-events: auto; cursor: ew-resize; z-index: 9999;"></div>
                <div style="position: absolute; bottom: -2px; left: 50%; transform: translateX(-50%); width: 14px; height: 14px; background-color: #fb7185; border: 2px solid #ffffff; border-radius: 50%; box-shadow: 0 2px 6px rgba(0,0,0,0.8); pointer-events: auto; cursor: ew-resize; z-index: 9999;"></div>
              `;
            }
          }
        }
      });

      wavesurfer.current.on('play', () => setIsPlaying(true));
      wavesurfer.current.on('pause', () => setIsPlaying(false));
      wavesurfer.current.on('timeupdate', (time: number) => setCurrentTime(time));
      wavesurfer.current.on('seeking', (time: number) => setCurrentTime(time));
      wavesurfer.current.on('audioprocess', (time: number) => setCurrentTime(time));
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
    const validLineIds = new Set(lyrics.filter(l => l.start !== null).map(l => `line-${l.id}`));

    // Remove deleted or unsynced regions
    existingRegions.forEach(r => {
      if (r.id.startsWith('line-') && !validLineIds.has(r.id)) {
        r.remove();
      }
    });

    lyrics.forEach((line, i) => {
      // Only render lines that have been synced!
      if (line.start === null) return;

      const wStart = line.start;
      let wEnd = line.end;
      
      // If end is null (e.g. the very last stamped line), guess the end time based on the next line or add 2 seconds
      if (wEnd === null) {
        const nextLine = lyrics.slice(i + 1).find(l => l.start !== null);
        if (nextLine && nextLine.start !== null) {
          wEnd = nextLine.start;
        } else {
          wEnd = wStart + 2.0; 
        }
      }

      // Safeguard: Ensure end is strictly greater than start to avoid region crashing
      if (wEnd <= wStart) {
        wEnd = wStart + 0.5;
      }

      const regionId = `line-${line.id}`;
      const existing = existingRegions.find(r => r.id === regionId);

      if (existing) {
        // Update if significantly different (avoids interrupting active drags)
        if (Math.abs(existing.start - wStart) > 0.05 || Math.abs(existing.end - wEnd) > 0.05) {
          existing.setOptions({ start: wStart, end: wEnd });
        }
      } else {
        const contentEl = document.createElement('div');
        // Removed native title and reverted pointer-events to none so WaveSurfer can properly detect clicks and drags on the region!
        contentEl.style.cssText = 'width: 100%; height: 100%; display: flex; align-items: center; justify-content: flex-start; padding: 0 4px; box-sizing: border-box; overflow: hidden; pointer-events: none; border-left: 2px solid rgba(255,255,255,0.4); border-right: 2px solid rgba(255,255,255,0.4);'; 
        
        const textSpan = document.createElement('span');
        textSpan.innerText = line.text;
        textSpan.style.cssText = 'color: #fff; font-size: 14px; font-weight: bold; text-shadow: 0 1px 3px rgba(0,0,0,0.9); white-space: nowrap; text-overflow: ellipsis; overflow: hidden; max-width: 100%; pointer-events: none;';
        
        contentEl.appendChild(textSpan);

        // Alternate region background colors to clearly separate them
        const regionColor = i % 2 === 0 ? 'rgba(56, 189, 248, 0.15)' : 'rgba(168, 85, 247, 0.15)'; // Sky blue vs Purple

        regions.current!.addRegion({
          start: wStart,
          end: wEnd,
          content: contentEl,
          color: regionColor,
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
          <div className="flex items-center gap-2 px-3 py-1 bg-[#0d0e12] rounded-full border border-[#1f222b]">
            <span className="text-xs font-mono text-[#38bdf8]">{formatTime(currentTime)}</span>
            <span className="text-xs font-mono text-[#71717a]">/ {formatTime(duration)}</span>
          </div>
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
      
      {/* Cinematic Scrolling Lyric Screen (Apple Music Style) */}
      <div className="h-48 shrink-0 bg-[#09090b] border-b border-[#1f222b] overflow-hidden relative flex flex-col items-center justify-start">
        {/* Ambient Glow */}
        <div className="absolute inset-0 flex items-center justify-center opacity-20 pointer-events-none">
          <div className="w-[300px] h-[100px] bg-[#38bdf8] blur-[80px] rounded-full mix-blend-screen" />
        </div>

        {/* Scroll Masks */}
        <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-[#09090b] to-transparent z-10 pointer-events-none" />
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#09090b] to-transparent z-10 pointer-events-none" />

        {/* Rolling Lyrics Container */}
        <div 
          className="flex flex-col items-center w-full transition-transform duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
          style={{ transform: `translateY(${-(focusIndex * 48)}px)`, marginTop: '72px' }}
        >
          {lyrics.length === 0 ? (
            <div className="h-[48px] flex items-center justify-center w-full text-sm font-mono text-[#71717a] italic">No synced lyrics...</div>
          ) : (
            lyrics.map((line, idx) => {
              const isActive = activeLyric && activeLyric.id === line.id;
              const isPast = idx < focusIndex;
              
              return (
                <div 
                  key={line.id}
                  className={`h-[48px] flex flex-col items-center justify-center w-full px-8 transition-all duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
                    isActive 
                      ? 'scale-100 opacity-100' 
                      : isPast
                        ? 'scale-95 opacity-40'
                        : 'scale-95 opacity-60'
                  }`}
                >
                  <span className={`truncate max-w-full text-center ${isActive ? 'text-2xl md:text-3xl font-black text-white drop-shadow-[0_0_15px_rgba(56,189,248,0.4)]' : isActive === false && isPast ? 'text-xl font-bold text-[#3f3f46]' : 'text-xl font-bold text-[#52525b]'}`}>
                    {line.text}
                  </span>
                  {isActive && (
                    <span className="text-xs font-mono text-[#38bdf8] opacity-80 mt-1 animate-in fade-in zoom-in duration-300">
                      {line.start !== null ? line.start.toFixed(2) : '0.00'}s - {line.end !== null ? line.end.toFixed(2) : '...'}s
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="flex-1 p-4 overflow-hidden flex flex-col relative">
        {/* Waveform (Timeline will be automatically injected inside here by WaveSurfer) */}
        <div 
          ref={containerRef} 
          className="waveform-container w-full flex-1 rounded bg-[#0d0e12] border border-[#1f222b] custom-scrollbar overflow-y-auto"
        />
      </div>
    </div>
  );
}
