import React, { useState, useRef, useEffect, useMemo } from "react";
import { 
  Play, Pause, Download, Edit3, Save, Search, Volume2, Clock, 
  ArrowLeft, RotateCcw, AlertTriangle, FileText, Check, FileCode, CheckCheck, RefreshCw, AudioLines,
  Sparkles
} from "lucide-react";
import { SubtitleSegment, Task } from "../types";

interface SubtitlePlayerProps {
  task: Task;
  initialAudioUrl?: string | null;
  onBack: () => void;
}

export default function SubtitlePlayer({ task, initialAudioUrl, onBack }: SubtitlePlayerProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(initialAudioUrl || null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingSegmentId, setEditingSegmentId] = useState<number | null>(null);
  const [editTempText, setEditTempText] = useState("");
  const [editTempVisualPrompt, setEditTempVisualPrompt] = useState("");
  const [copiedFormat, setCopiedFormat] = useState<string | null>(null);

  // Maintain local state of edited segments so the user can modify and export
  const [segments, setSegments] = useState<SubtitleSegment[]>(() => {
    return task.result?.json ? JSON.parse(JSON.stringify(task.result.json)) : [];
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const segmentRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // Reset or initialize segments if the task changes
  useEffect(() => {
    if (task.result?.json) {
      setSegments(JSON.parse(JSON.stringify(task.result.json)));
    }
  }, [task]);

  // Track audio times
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
    };
  }, [audioUrl]);

  // Find currently active segment based on current time
  const activeSegmentId = useMemo(() => {
    const active = segments.find(
      (seg) => currentTime >= seg.start && currentTime <= seg.end
    );
    return active ? active.id : null;
  }, [segments, currentTime]);

  // Auto-scroll the active segment card into view within the scrollbox container
  useEffect(() => {
    if (activeSegmentId !== null) {
      const activeElement = segmentRefs.current[activeSegmentId];
      if (activeElement) {
        activeElement.scrollIntoView({
          behavior: "smooth",
          block: "nearest"
        });
      }
    }
  }, [activeSegmentId]);

  // Synchronize playback rate
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, audioUrl]);

  // Synchronize volume
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume, audioUrl]);

  // Filtered segments on search query
  const filteredSegments = useMemo(() => {
    if (!searchQuery.trim()) return segments;
    return segments.filter((seg) => 
      seg.text.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [segments, searchQuery]);

  // Format second helpers
  const formatTimeLabel = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 10);
    return `${m}:${s.toString().padStart(2, "0")}.${ms}`;
  };

  const handleSeek = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
      if (!isPlaying) {
        audioRef.current.play().catch(() => {});
      }
    }
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(() => {});
    }
  };

  // Skip backward or forward by standard delta seconds
  const skipTime = (amount: number) => {
    if (audioRef.current) {
      let newTime = audioRef.current.currentTime + amount;
      if (newTime < 0) newTime = 0;
      if (newTime > audioRef.current.duration) newTime = audioRef.current.duration;
      audioRef.current.currentTime = newTime;
    }
  };

  // Inline edit handlers
  const startEditing = (seg: SubtitleSegment) => {
    setEditingSegmentId(seg.id);
    setEditTempText(seg.text);
    setEditTempVisualPrompt(seg.visual_prompt || "");
  };

  const saveEditing = (id: number) => {
    setSegments(prev => 
      prev.map(seg => seg.id === id ? { ...seg, text: editTempText, visual_prompt: editTempVisualPrompt } : seg)
    );
    setEditingSegmentId(null);
  };

  const handleAudioFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
    }
  };

  // Dynamically compile download payloads based on local edits
  const downloadSubtitleFile = (format: "srt" | "vtt" | "json" | "txt") => {
    let content = "";
    let mimeType = "text/plain";
    let filename = `${task.originalName.replace(/\.[^/.]+$/, "")}_subtitles`;

    const formatSecondsHelper = (secs: number, isVtt = false) => {
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = Math.floor(secs % 60);
      const ms = Math.floor((secs % 1) * 1000);
      const pad = (num: number, size = 2) => String(num).padStart(size, "0");
      const msDelim = isVtt ? "." : ",";
      return `${pad(h)}:${pad(m)}:${pad(s)}${msDelim}${pad(ms, 3)}`;
    };

    if (format === "srt") {
      content = segments.map((seg, idx) => {
        return `${idx + 1}\n${formatSecondsHelper(seg.start, false)} --> ${formatSecondsHelper(seg.end, false)}\n${seg.text}\n`;
      }).join("\n");
      mimeType = "application/x-subrip";
      filename += ".srt";
    } else if (format === "vtt") {
      const blocks = segments.map((seg) => {
        return `${formatSecondsHelper(seg.start, true)} --> ${formatSecondsHelper(seg.end, true)}\n${seg.text}\n`;
      });
      content = `WEBVTT\n\n` + blocks.join("\n");
      mimeType = "text/vtt";
      filename += ".vtt";
    } else if (format === "json") {
      content = JSON.stringify(segments, null, 2);
      mimeType = "application/json";
      filename += ".json";
    } else {
      content = segments.map(s => s.text).join(" ");
      mimeType = "text/plain";
      filename += ".txt";
    }

    const blob = new Blob([content], { type: mimeType });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyToClipboard = (format: "srt" | "vtt") => {
    const formatSecondsHelper = (secs: number, isVtt = false) => {
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = Math.floor(secs % 60);
      const ms = Math.floor((secs % 1) * 1000);
      const pad = (num: number, size = 2) => String(num).padStart(size, "0");
      const msDelim = isVtt ? "." : ",";
      return `${pad(h)}:${pad(m)}:${pad(s)}${msDelim}${pad(ms, 3)}`;
    };

    let text = "";
    if (format === "srt") {
      text = segments.map((seg, idx) => {
        return `${idx + 1}\n${formatSecondsHelper(seg.start, false)} --> ${formatSecondsHelper(seg.end, false)}\n${seg.text}\n`;
      }).join("\n");
    } else {
      const blocks = segments.map((seg) => {
        return `${formatSecondsHelper(seg.start, true)} --> ${formatSecondsHelper(seg.end, true)}\n${seg.text}\n`;
      });
      text = `WEBVTT\n\n` + blocks.join("\n");
    }

    navigator.clipboard.writeText(text).then(() => {
      setCopiedFormat(format);
      setTimeout(() => setCopiedFormat(null), 2000);
    });
  };

  return (
    <div id="subtitle-player-workspace" className="flex flex-col h-full bg-slate-50 text-slate-800 overflow-hidden flex-1">
      
      {/* Header Top Bar */}
      <header id="workspace-header" className="bg-white border-b border-slate-200 px-6 py-3 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-10 shadow-3xs shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button 
            id="back-list-btn"
            onClick={onBack}
            className="p-1.5 hover:bg-slate-100 border border-slate-200 rounded text-slate-600 transition shrink-0"
            title="Back to Dashboard"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          
          <div className="w-6 h-6 bg-indigo-650 rounded-sm flex items-center justify-center shrink-0">
            <div className="w-3.5 h-3.5 border border-white rotate-45"></div>
          </div>

          <div className="min-w-0">
            <h1 className="font-sans font-bold text-sm text-slate-900 tracking-tight truncate font-display">
              {task.originalName}
            </h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
              Workspace UID: <span className="font-mono font-normal tracking-normal text-slate-400 select-all">{task.id}</span>
            </p>
          </div>
        </div>

        {/* Action downloads list - Elegant horizontal board */}
        <div className="flex items-center flex-wrap gap-3 shrink-0">
          <div className="bg-slate-100 p-0.5 rounded border border-slate-200 flex items-center gap-0.5 text-[11px] font-bold text-slate-500">
            <span className="px-2.5">Export:</span>
            <button 
              id="download-srt"
              onClick={() => downloadSubtitleFile("srt")}
              className="bg-white hover:bg-slate-50 text-slate-800 px-2 py-0.5 border border-slate-200 transition font-bold"
            >
              .SRT
            </button>
            <button 
              id="download-vtt"
              onClick={() => downloadSubtitleFile("vtt")}
              className="bg-white hover:bg-slate-50 text-slate-800 px-2 py-0.5 border border-slate-200 transition font-bold"
            >
              .VTT
            </button>
            <button 
              id="download-json"
              onClick={() => downloadSubtitleFile("json")}
              className="bg-white hover:bg-slate-50 text-slate-800 px-2 py-0.5 border border-slate-200 transition font-bold"
            >
              .JSON
            </button>
            <button 
              id="download-txt"
              onClick={() => downloadSubtitleFile("txt")}
              className="bg-white hover:bg-slate-50 text-slate-800 px-2 py-0.5 border border-slate-200 transition font-bold"
            >
              Text
            </button>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              id="copy-srt-btn"
              onClick={() => copyToClipboard("srt")}
              className="text-[10px] bg-slate-900 hover:bg-slate-850 text-white px-2.5 py-1.5 rounded flex items-center gap-1.5 transition uppercase tracking-wider font-bold"
            >
              {copiedFormat === "srt" ? <Check className="w-3 h-3" /> : <FileCode className="w-3 h-3" />}
              {copiedFormat === "srt" ? "Copied" : "Copy SRT"}
            </button>
            <button
              id="copy-vtt-btn"
              onClick={() => copyToClipboard("vtt")}
              className="text-[10px] bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 px-2.5 py-1.5 rounded flex items-center gap-1.5 transition uppercase tracking-wider font-bold"
            >
              {copiedFormat === "vtt" ? <Check className="w-3 h-3" /> : <FileCode className="w-3 h-3" />}
              {copiedFormat === "vtt" ? "Copied" : "Copy VTT"}
            </button>
          </div>
        </div>
      </header>

      {/* Main Container Sandbox Workspace */}
      <div id="media-flex-grid" className="flex-1 flex flex-col lg:flex-row gap-6 p-6 overflow-hidden h-[calc(100vh-64px)]">
        
        {/* Playback Settings Panel - Width 5/12 for perfect balance */}
        <div id="panel-audio-ctrl" className="lg:w-5/12 flex flex-col gap-6 h-full overflow-y-auto">
          
          {/* Card: Audio Player Deck with geometric border style */}
          <div className="bg-white border border-slate-200 p-6 shadow-3xs flex flex-col gap-5 relative">
            {/* Corner balance frames */}
            <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-slate-200 pointer-events-none"></div>
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-slate-200 pointer-events-none"></div>

            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center gap-2">
                <AudioLines className="w-4 h-4 text-indigo-600" /> Player console
              </span>
              <span className="text-[10px] font-mono bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded font-bold">
                {formatTimeLabel(currentTime)}
              </span>
            </div>

            {audioUrl ? (
              <div className="flex flex-col gap-4">
                {/* Audio Element */}
                <audio 
                  ref={audioRef}
                  src={audioUrl}
                  preload="auto"
                  className="hidden"
                />

                {/* Waveform graphic matching ScribeSync style */}
                <div className="bg-slate-950 h-20 flex items-center justify-center p-3 overflow-hidden relative group">
                  <div className="absolute inset-0 bg-radial-at-t from-slate-900 via-slate-950 to-black opacity-95"></div>
                  
                  <div className="absolute top-2 left-3 z-10 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span className="text-[9px] font-mono font-bold tracking-widest text-slate-550 uppercase">PLAYHEAD DECODING</span>
                  </div>

                  <div className="relative z-10 flex items-end justify-center h-10 gap-0.5 w-full">
                    {Array.from({ length: 40 }).map((_, i) => (
                      <div 
                        key={i} 
                        className={`w-0.5 bg-indigo-500 rounded-sm transition-all duration-300 ${
                          isPlaying ? "animate-wave-bar" : "h-1 opacity-40"
                        }`}
                        style={{
                          height: isPlaying ? `${Math.floor(Math.random() * 30) + 6}px` : "4px",
                          animationDelay: `${i * 0.03}s`,
                          animationDuration: `${0.7 + Math.random() * 0.6}s`
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* Scrub seek bar */}
                <div className="flex flex-col gap-1">
                  <input
                    id="scrubber-range"
                    type="range"
                    min="0"
                    max={audioRef.current?.duration || 100}
                    step="0.05"
                    value={currentTime}
                    onChange={(e) => {
                      const time = parseFloat(e.target.value);
                      if (audioRef.current) {
                        audioRef.current.currentTime = time;
                        setCurrentTime(time);
                      }
                    }}
                    className="w-full h-1 bg-slate-200 rounded appearance-none cursor-pointer accent-indigo-600 focus:outline-none"
                  />
                  <div className="flex justify-between text-[10px] font-bold text-slate-400 font-mono">
                    <span>{formatTimeLabel(currentTime)}</span>
                    <span>{audioRef.current?.duration ? formatTimeLabel(audioRef.current.duration) : "--:--"}</span>
                  </div>
                </div>

                {/* Control triggers */}
                <div className="flex items-center justify-center gap-4 py-1">
                  <button
                    id="skip-back"
                    onClick={() => skipTime(-5)}
                    className="p-1.5 text-slate-550 hover:text-slate-900 hover:bg-slate-100 transition rounded"
                    title="Skip Back 5s"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>

                  <button
                    id="play-pause-toggle"
                    onClick={togglePlay}
                    className="w-10 h-10 rounded-full bg-indigo-650 hover:bg-indigo-700 text-white flex items-center justify-center shadow-lg shadow-indigo-100 transition transform active:scale-95"
                    title={isPlaying ? "Pause" : "Play"}
                  >
                    {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                  </button>

                  <button
                    id="skip-forward"
                    onClick={() => skipTime(5)}
                    className="p-1.5 text-slate-550 hover:text-slate-900 hover:bg-slate-100 transition rounded rotate-180"
                    title="Skip Forward 5s"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>

                {/* Speed & volume adjustments */}
                <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold text-slate-400 tracking-wider uppercase font-mono">Playback Speed</label>
                    <select
                      id="speed-select"
                      value={playbackRate}
                      onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
                      className="text-xs bg-slate-50 border border-slate-200 p-2 font-bold text-slate-700 outline-none"
                    >
                      <option value="0.5">0.5x</option>
                      <option value="0.75">0.75x</option>
                      <option value="1.0">1.0x (Normal)</option>
                      <option value="1.25">1.25x</option>
                      <option value="1.5">1.5x</option>
                      <option value="2.0">2.0x</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] font-bold text-slate-400 tracking-wider uppercase font-mono">Volume</label>
                    <div className="flex items-center gap-2 py-1.5">
                      <Volume2 className="w-3.5 h-3.5 text-slate-400" />
                      <input
                        id="volume-range"
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={volume}
                        onChange={(e) => setVolume(parseFloat(e.target.value))}
                        className="w-full h-1 bg-slate-200 rounded appearance-none cursor-pointer accent-slate-500"
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-slate-50 p-5 border border-dashed border-slate-300 text-center flex flex-col items-center gap-3">
                <div className="w-10 h-10 rounded bg-slate-200 flex items-center justify-center text-slate-500">
                  <Play className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-900 font-display">Audio playback offline</h3>
                  <p className="text-[11px] text-slate-400 max-w-xs mt-1 leading-relaxed">
                    Attach the sound track to synchronise current timelines with audio playback.
                  </p>
                </div>
                <label className="bg-indigo-600 hover:bg-indigo-700 cursor-pointer text-white text-[10px] uppercase tracking-wider font-bold px-4 py-2 rounded transition shadow-sm mt-1 z-10">
                  Attach Audio File
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={handleAudioFileImport}
                    className="hidden"
                  />
                </label>
              </div>
            )}
          </div>

          {/* Full Plain Transcript Deck */}
          <div className="bg-white border border-slate-200 p-6 flex flex-col gap-3 flex-1 min-h-[180px] overflow-hidden">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 font-mono flex items-center gap-2 border-b border-slate-100 pb-3 shrink-0">
              <FileText className="w-4 h-4 text-slate-500" /> Plain-text Transcript
            </span>
            <div className="flex-1 overflow-y-auto text-xs text-slate-600 font-sans leading-relaxed tracking-wide space-y-3 selection:bg-indigo-100 pr-1">
              <p className="p-3.5 bg-slate-50 text-slate-700 leading-relaxed font-sans border border-slate-100">
                {task.result?.transcript || "No transcription text compiled."}
              </p>
            </div>
          </div>

        </div>

        {/* Subtitle segments / edit sidebar list - Width 7/12 for optimal density */}
        <div id="panel-subs-list" className="lg:w-7/12 flex flex-col gap-4 h-full overflow-hidden">
          
          {/* Card filter and edit indicators */}
          <div className="bg-white border border-slate-200 p-3 shadow-3xs flex items-center justify-between gap-4 shrink-0">
            <div className="relative flex-1">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-3.5 w-3.5 text-slate-455" />
              </div>
              <input
                id="search-subs-input"
                type="text"
                placeholder="Search captions by keywords..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="block w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 text-xs placeholder-slate-400 focus:outline-none focus:bg-white transition outline-none"
              />
            </div>
            
            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider font-mono shrink-0">
              Captions: <span className="text-slate-800">{filteredSegments.length}</span> / {segments.length}
            </div>
          </div>

          {/* Scrolling Subtitle blocks list viewport */}
          <div id="subtitles-viewport-container" className="flex-1 overflow-y-auto space-y-3 pr-1">
            {filteredSegments.length === 0 ? (
              <div className="bg-white p-12 text-center border border-slate-200 flex flex-col items-center justify-center gap-3">
                <div className="w-10 h-10 bg-slate-100 rounded flex items-center justify-center text-slate-400 shadow-3xs">
                  <Search className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-800 font-display">No query matches</h3>
                  <p className="text-[11px] text-slate-400 mt-1">Try resetting the keyword filter or typing alternate words.</p>
                </div>
              </div>
            ) : (
              filteredSegments.map((seg) => {
                const isActive = activeSegmentId === seg.id;
                const isEditing = editingSegmentId === seg.id;

                return (
                  <div
                    key={seg.id}
                    ref={(el) => {
                      segmentRefs.current[seg.id] = el;
                    }}
                    id={`segment-card-${seg.id}`}
                    onClick={() => {
                      if (!isEditing) handleSeek(seg.start);
                    }}
                    className={`p-5 border transition-all duration-200 cursor-pointer text-left relative flex flex-col gap-2.5 group ${
                      isActive 
                        ? "bg-slate-50/80 border border-slate-350 border-l-4 border-l-indigo-650 shadow-xs" 
                        : "bg-white hover:bg-slate-50/40 border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    {/* Timestamp header bar */}
                    <div className="flex items-center justify-between border-b border-dashed border-slate-100 pb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] font-bold font-mono px-1.5 py-0.2 rounded uppercase ${
                          isActive ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-550 border border-slate-200"
                        }`}>
                          Caption #{seg.id}
                        </span>
                        <div className="flex items-center gap-1 text-[10px] text-slate-400 font-mono font-semibold">
                          <Clock className="w-3 h-3 text-slate-300" />
                          <span>{formatTimeLabel(seg.start)}</span>
                          <span>&rarr;</span>
                          <span>{formatTimeLabel(seg.end)}</span>
                        </div>
                      </div>

                      {/* Tool trigger handles */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {isEditing ? (
                          <button
                            id={`save-seg-btn-${seg.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              saveEditing(seg.id);
                            }}
                            className="p-1 hover:bg-emerald-50 text-emerald-600 border border-slate-200 bg-white rounded transition"
                            title="Save text changes"
                          >
                            <Save className="w-3 h-3" />
                          </button>
                        ) : (
                          <button
                            id={`edit-seg-btn-${seg.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              startEditing(seg);
                            }}
                            className="p-1 hover:bg-indigo-50 text-indigo-600 border border-slate-200 bg-white rounded transition"
                            title="Edit Caption Text"
                          >
                            <Edit3 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Word display or textarea */}
                    <div className="relative font-sans flex flex-col gap-3">
                      {isEditing ? (
                        <div className="flex flex-col gap-2.5">
                          <div>
                            <label className="block text-[9px] font-bold text-slate-455 uppercase tracking-wider font-mono mb-1">Subtitle Text</label>
                            <textarea
                              id={`textarea-seg-${seg.id}`}
                              value={editTempText}
                              onChange={(e) => setEditTempText(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              rows={2}
                              className="w-full text-xs p-2 border border-slate-250 bg-slate-50 outline-none focus:bg-white font-sans text-slate-800"
                            />
                          </div>
                          <div>
                            <label className="block text-[9px] font-bold text-slate-455 uppercase tracking-wider font-mono mb-1 animate-pulse flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-indigo-600" />
                              Visual Prompt (English)
                            </label>
                            <textarea
                              id={`textarea-prompt-${seg.id}`}
                              value={editTempVisualPrompt}
                              onChange={(e) => setEditTempVisualPrompt(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              rows={2}
                              className="w-full text-xs p-2 border border-slate-250 bg-slate-50 outline-none focus:bg-white font-sans text-slate-800"
                              placeholder="Describe the cinematic scene perfectly matching this subtitle..."
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className={`text-xs leading-relaxed tracking-wide font-medium ${
                            isActive ? "text-indigo-950 font-bold" : "text-slate-700"
                          }`}>
                            {seg.text}
                          </p>
                          
                          {seg.visual_prompt && (
                            <div 
                              className={`mt-1.5 p-3 rounded text-[11px] border leading-relaxed select-text transition-colors ${
                                isActive 
                                  ? "bg-indigo-50/50 border-indigo-150/70 text-indigo-950" 
                                  : "bg-slate-50/80 border-slate-150 text-slate-650"
                              }`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex items-center justify-between mb-1.5 text-[9px] font-bold text-indigo-700 font-mono tracking-widest uppercase">
                                <span className="flex items-center gap-1">
                                  <Sparkles className="w-3.5 h-3.5 text-indigo-650 shrink-0" />
                                  Visual Prompt (English)
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(seg.visual_prompt || "");
                                  }}
                                  className="text-[8px] bg-white border border-slate-200 text-slate-600 hover:text-indigo-650 px-2 py-0.5 rounded shadow-3xs hover:bg-indigo-50 transition cursor-pointer font-bold"
                                  title="Copy Prompt text"
                                >
                                  Copy Prompt
                                </button>
                              </div>
                              <p className="font-sans font-medium text-[11px] leading-relaxed italic text-slate-600">
                                "{seg.visual_prompt}"
                              </p>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="bg-slate-150 p-3 text-[10px] font-bold text-slate-500 font-mono uppercase tracking-wider shrink-0">
            💡 Click any caption card to focus playhead • Inline edits instantly preserve export format coordinates.
          </div>

        </div>

      </div>

    </div>
  );
}
