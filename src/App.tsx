import React, { useState, useEffect, useCallback, useRef } from "react";
import { 
  Upload, FileAudio, RotateCcw, AlertCircle, Loader2, Music, CheckCircle2, 
  Trash2, ChevronRight, HelpCircle, ArrowUpRight, Clock, HardDrive, Languages, Grid, ListCollapse, Subtitles,
  Sparkles
} from "lucide-react";
import { Task } from "./types";
import SubtitlePlayer from "./components/SubtitlePlayer";
import { compressAudio, CompressionProgress } from "./utils/audioCompressor";

export default function App() {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [isCurrentlyUploading, setIsCurrentlyUploading] = useState(false);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  const [pollingTaskId, setPollingTaskId] = useState<string | null>(null);

  // Mode Selection: audio upload or direct text input
  const [activeTab, setActiveTab] = useState<"audio" | "text">("audio");
  const [directTextInput, setDirectTextInput] = useState("");

  // States for audio compression tracking
  const [compressionProgress, setCompressionProgress] = useState<CompressionProgress | null>(null);
  const [wasCompressed, setWasCompressed] = useState(false);
  const [originalSize, setOriginalSize] = useState<number | null>(null);
  const [cookieBlockedAlert, setCookieBlockedAlert] = useState(false);

  // Transcription Settings (Connected with interactive states)
  const [selectedLanguage, setSelectedLanguage] = useState("English (Auto-detect)");
  const [preferredFormat, setPreferredFormat] = useState(".SRT");
  const [timestampsEnabled, setTimestampsEnabled] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load all tasks on mount
  const fetchTasks = useCallback(async () => {
    try {
      const response = await fetch("/api/tasks", { credentials: "include" });
      if (response.ok) {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          const data = await response.json();
          setTasks(data);
        } else {
          console.warn("Expected JSON from /api/tasks, but received non-JSON header.");
          const rawText = await response.text();
          if (rawText.includes("Cookie check") || rawText.includes("doctype html") || rawText.includes("<html")) {
            setCookieBlockedAlert(true);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch jobs history:", err);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Polling thread for running transcribers
  useEffect(() => {
    if (!pollingTaskId) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/tasks/${pollingTaskId}`, { credentials: "include" });
        if (response.ok) {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const task: Task = await response.json();
            
            // Sync with currently active screen if selected
            if (activeTask && activeTask.id === pollingTaskId) {
              setActiveTask(task);
            }

            // If finished or crashed, cancel polling
            if (task.status === "completed" || task.status === "failed") {
              setPollingTaskId(null);
              fetchTasks();
            }
          } else {
            console.warn(`Polling got non-JSON format: ${response.status}`);
            const rawText = await response.text();
            if (rawText.includes("Cookie check") || rawText.includes("doctype html") || rawText.includes("<html")) {
              setCookieBlockedAlert(true);
            }
          }
        } else {
          setPollingTaskId(null);
        }
      } catch (err) {
        console.error("Polling error:", err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [pollingTaskId, activeTask, fetchTasks]);

  // Handle file select inputs
  const processSelectedFile = (file: File) => {
    if (!file.type.startsWith("audio/") && !file.name.match(/\.(mp3|wav|m4a|ogg|aac|flac)$/i)) {
      setErrorStatus("Invalid format. Please upload a standard audio file (MP3, WAV, M4A, OGG, or AAC).");
      return;
    }
    
    setWasCompressed(false);
    setCompressionProgress(null);
    setOriginalSize(file.size);
    setErrorStatus(null);
    setSelectedFile(file);

    // Create local preview URL for offline play sync
    const url = URL.createObjectURL(file);
    setUploadedFileUrl(url);

    const maxSizeBytes = 25 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      setErrorStatus(`Selected file is ${(file.size / (1024 * 1024)).toFixed(1)} MB (exceeds safe 25 MB upload size). Please use the Audio Compressor tool below to optimize and reduce the file size to continue.`);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFormChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      processSelectedFile(e.target.files[0]);
    }
  };

  const handleTriggerUpload = async () => {
    if (!selectedFile) return;

    setIsCurrentlyUploading(true);
    setErrorStatus(null);

    const formData = new FormData();
    formData.append("audio", selectedFile);

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      if (!response.ok) {
        let errorMsg = "Upload service failed. Please verify API key state.";
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.toLowerCase().includes("application/json")) {
          const errData = await response.json();
          errorMsg = errData.error || errorMsg;
        } else {
          const htmlText = await response.text();
          console.error("Non-JSON error from /api/upload:", htmlText.substring(0, 500));
          if (htmlText.includes("Cookie check") || htmlText.includes("doctype html") || htmlText.includes("<html")) {
            setCookieBlockedAlert(true);
            errorMsg = "Your browser is blocking session cookies inside this iframe. Please click 'Open in New Tab' to resolve this restriction.";
          } else if (response.status === 413 || htmlText.includes("Too Large") || htmlText.includes("413")) {
            errorMsg = "The file is too large for the servers to process at once (max allowed is ~25 MB). Please compress your audio or select a smaller file.";
          }
        }
        throw new Error(errorMsg);
      }

      const contentType = response.headers.get("content-type");
      let data;
      if (contentType && contentType.toLowerCase().includes("application/json")) {
        data = await response.json();
      } else {
        const htmlText = await response.text();
        console.error("Non-JSON success from /api/upload:", htmlText.substring(0, 500));
        if (htmlText.includes("Cookie check") || htmlText.includes("doctype html") || htmlText.includes("<html")) {
          setCookieBlockedAlert(true);
          throw new Error("Your browser is blocking session cookies inside this iframe window. Please click 'Open in New Tab' to transcribe successfully.");
        }
        throw new Error("Invalid response format from server.");
      }

      const newTaskId = data.taskId;

      // Start polling status
      setPollingTaskId(newTaskId);
      
      // Load this task as the active background view
      const tempTask: Task = {
        id: newTaskId,
        status: "uploading",
        originalName: selectedFile.name,
        fileSize: selectedFile.size,
        progressMessage: "Handing off stream payload over to server pipeline...",
        timestamp: new Date().toISOString()
      };
      setActiveTask(tempTask);
      fetchTasks();

    } catch (err: any) {
      console.error(err);
      setErrorStatus(err.message || "An unexpected network error occurred.");
    } finally {
      setIsCurrentlyUploading(false);
      setSelectedFile(null);
    }
  };

  // Direct script text upload handler
  const handleTriggerTextSubmit = async () => {
    if (!directTextInput.trim()) return;

    setIsCurrentlyUploading(true);
    setErrorStatus(null);

    try {
      const response = await fetch("/api/transcribe-text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ text: directTextInput }),
        credentials: "include"
      });

      if (!response.ok) {
        let errorMsg = "Text processing service failed. Please verify API key state.";
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.toLowerCase().includes("application/json")) {
          const errData = await response.json();
          errorMsg = errData.error || errorMsg;
        } else {
          const htmlText = await response.text();
          console.error("Non-JSON error from /api/transcribe-text:", htmlText.substring(0, 500));
          if (htmlText.includes("Cookie check") || htmlText.includes("doctype html") || htmlText.includes("<html")) {
            setCookieBlockedAlert(true);
            errorMsg = "Your browser is blocking session cookies inside this iframe. Please click 'Open in New Tab' to resolve this restriction.";
          }
        }
        throw new Error(errorMsg);
      }

      const contentType = response.headers.get("content-type");
      let data;
      if (contentType && contentType.toLowerCase().includes("application/json")) {
        data = await response.json();
      } else {
        const htmlText = await response.text();
        console.error("Non-JSON success from /api/transcribe-text:", htmlText.substring(0, 500));
        if (htmlText.includes("Cookie check") || htmlText.includes("doctype html") || htmlText.includes("<html")) {
          setCookieBlockedAlert(true);
          throw new Error("Your browser is blocking session cookies inside this iframe window. Please click 'Open in New Tab' to convert successfully.");
        }
        throw new Error("Invalid response format from server.");
      }

      const newTaskId = data.taskId;

      // Start polling status
      setPollingTaskId(newTaskId);

      // Load this task as the active background view
      const tempTask: Task = {
        id: newTaskId,
        status: "transcribing",
        originalName: "Direct Text: " + (directTextInput.substring(0, 24) + (directTextInput.length > 24 ? "..." : "")),
        fileSize: new Blob([directTextInput]).size,
        progressMessage: "Converting direct text into structured cinematic narrative...",
        timestamp: new Date().toISOString()
      };
      setActiveTask(tempTask);
      setDirectTextInput("");
      fetchTasks();

    } catch (err: any) {
      console.error(err);
      setErrorStatus(err.message || "An unexpected network error occurred.");
    } finally {
      setIsCurrentlyUploading(false);
    }
  };

  // Convert bytes helper
  const renderSizeLabel = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Dynamic sandbox storage space calculation
  const totalBytesInSandbox = tasks.reduce((sum, t) => sum + (t.fileSize || 0), 0);
  const maxStorageBytes = 5 * 1024 * 1024 * 1024; // 5 GB default sandbox limit
  const storagePercentage = Math.min(100, Math.round((totalBytesInSandbox / maxStorageBytes) * 100));

  const renderBadgeStatus = (status: Task["status"]) => {
    switch (status) {
      case "uploading":
        return <span className="bg-indigo-50 text-indigo-600 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider animate-pulse shrink-0">Uploading</span>;
      case "transcribing":
        return <span className="bg-amber-50 text-amber-700 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider animate-pulse shrink-0">Transcribing</span>;
      case "completed":
        return <span className="bg-emerald-50 text-emerald-600 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0">Finished</span>;
      case "failed":
        return <span className="bg-rose-50 text-rose-600 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0">Failed</span>;
    }
  };

  // Load a job from the lists
  const handleLoadTask = (task: Task) => {
    setActiveTask(task);
    if (task.status === "uploading" || task.status === "transcribing") {
      setPollingTaskId(task.id);
    }
  };

  return (
    <div id="application-container" className="min-h-screen bg-slate-50 flex flex-col font-sans select-none antialiased text-slate-900">
      
      {/* Top Navigation */}
      <nav id="dashboard-nav" className="h-16 px-6 md:px-8 border-b border-slate-200 bg-white flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          {/* Geometric Balance Icon (Indigo block with rotated square) */}
          <div className="w-8 h-8 bg-indigo-600 rounded-sm flex items-center justify-center shrink-0">
            <div className="w-4 h-4 border-2 border-white rotate-45"></div>
          </div>
          <span className="text-xl font-extrabold tracking-tight font-display text-slate-800">ScribeSync.io</span>
        </div>
        <div className="flex items-center gap-6">
          <span className="hidden md:inline text-xs font-semibold text-slate-400 bg-slate-100 hover:text-slate-600 px-3 py-1 rounded select-none cursor-pointer">
            Documentation
          </span>
          <span className="hidden md:inline text-xs font-semibold text-slate-400 bg-slate-100 hover:text-slate-600 px-3 py-1 rounded select-none cursor-pointer">
            Sandbox pricing
          </span>
          <div className="h-8 w-8 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center text-xs font-bold text-indigo-700">
            U
          </div>
        </div>
      </nav>

      {/* Cookie check session restriction warning banner */}
      {cookieBlockedAlert && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-4 shrink-0 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-amber-900 text-xs font-semibold relative animate-fade-in z-20">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="text-amber-950 font-bold block mb-0.5">Iframe Session Cookie Restriction Detected</span>
              <p className="text-amber-850 font-normal leading-relaxed">
                Your browser blocks third-party cookies inside this code-sandbox iframe. Because ScribeSync needs session state to secure and process file transcribers, please open the application in a separate tab to continue.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-1 md:mt-0 max-sm:w-full self-stretch justify-end">
            <a 
              href={window.location.href} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] px-3.5 py-2 hover:shadow transition flex items-center gap-1 shrink-0 cursor-pointer"
            >
              Open in New Tab
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
            <button 
              onClick={() => setCookieBlockedAlert(false)}
              className="text-amber-550 hover:text-amber-700 font-extrabold p-2 cursor-pointer transition"
              aria-label="Close banner"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* If an active job is selected and ready AND it is compiled successfully, mount full player editor workspace */}
      {activeTask && (activeTask.status === "completed" || activeTask.status === "failed") ? (
        <div id="full-workspace-view" className="flex-1 flex flex-col">
          {activeTask.status === "failed" ? (
            <div id="failed-task-screen" className="flex-1 flex flex-col items-center justify-center p-6 bg-white">
              <div className="max-w-md text-center p-8 border border-slate-200 bg-slate-50 flex flex-col items-center gap-4 relative">
                {/* Geometric decorative lines */}
                <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-slate-200"></div>
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-slate-200"></div>
                
                <div className="w-14 h-14 bg-rose-50 rounded-full flex items-center justify-center text-rose-500">
                  <AlertCircle className="w-8 h-8" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900 tracking-tight font-display">Transcription failed</h2>
                  <p className="text-sm text-slate-500 mt-2 font-medium">
                    An error occurred while compiling your subtitle payload from the speech track:
                  </p>
                  <p className="mt-3 p-3 bg-rose-50 border border-rose-100 rounded-lg font-mono text-xs text-rose-700 break-words text-left">
                    {activeTask.error || "No supplementary trace details returned by the engine."}
                  </p>
                </div>
                <div className="flex gap-2 w-full mt-2 z-10">
                  <button
                    id="back-home-err-btn"
                    onClick={() => {
                      setActiveTask(null);
                      setUploadedFileUrl(null);
                    }}
                    className="flex-1 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold text-sm py-2.5 rounded-lg transition"
                  >
                    Go Back Home
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <SubtitlePlayer 
              task={activeTask} 
              initialAudioUrl={uploadedFileUrl} 
              onBack={() => {
                setActiveTask(null);
                setUploadedFileUrl(null);
                fetchTasks();
              }} 
            />
          )}
        </div>
      ) : activeTask && (activeTask.status === "uploading" || activeTask.status === "transcribing") ? (
        
        /* Polling/Loading Screen */
        <div id="loading-polling-overlay" className="flex-1 flex items-center justify-center p-6 bg-white">
          <div className="max-w-md w-full text-center p-8 border border-slate-200 bg-slate-50 flex flex-col items-center gap-6 relative">
            <div className="absolute top-0 left-0 w-12 h-12 border-t-2 border-l-2 border-slate-200"></div>
            <div className="absolute bottom-0 right-0 w-12 h-12 border-b-2 border-r-2 border-slate-200"></div>

            <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600 relative">
              <Loader2 className="w-8 h-8 animate-spin" />
              <div className="absolute inset-0 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-ping opacity-20"></div>
            </div>

            <div className="w-full flex flex-col gap-2">
              <span className="text-[10px] font-bold tracking-wider text-indigo-600 font-mono uppercase bg-indigo-50 self-center px-2 py-0.5 rounded">
                Active Polling thread
              </span>
              <h2 className="text-lg font-bold text-slate-900 tracking-tight font-display">
                Subtitle Compilation in Progress
              </h2>
              <p className="text-sm text-slate-600 font-semibold max-w-sm mx-auto mt-1 line-clamp-1">
                {activeTask.originalName}
              </p>
              <p className="text-xs text-slate-400 font-medium">
                Size: <span className="font-mono text-slate-600">{renderSizeLabel(activeTask.fileSize)}</span>
              </p>
            </div>

            {/* Dynamic Status Progress Indicator Bar */}
            <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden relative">
              <div 
                className={`bg-indigo-600 h-full rounded-full transition-all duration-1000 ${
                  activeTask.status === "uploading" ? "w-1/3" : "w-3/4"
                }`}
              />
            </div>

            <div className="bg-white p-4 rounded border border-slate-150 w-full text-left flex gap-3 items-start">
              <span className="p-1.5 bg-slate-50 text-indigo-500 rounded shrink-0 mt-0.5">
                <Languages className="w-4 h-4" />
              </span>
              <div>
                <h4 className="text-[10px] font-bold tracking-wider text-slate-400 uppercase">Status message</h4>
                <p className="text-xs leading-relaxed text-slate-600 mt-0.5 font-medium">
                  {activeTask.progressMessage}
                </p>
              </div>
            </div>

            <div className="flex gap-2 w-full mt-1 z-10">
              <button
                id="cancel-monitor-btn"
                onClick={() => {
                  setActiveTask(null);
                  setPollingTaskId(null);
                  fetchTasks();
                }}
                className="flex-1 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-bold text-xs py-2.5 rounded transition"
              >
                Return to Dashboard (Runs in background)
              </button>
            </div>
          </div>
        </div>
      ) : (
        
        /* Central Dashboard View (Upload screen + job tables) - 8/12 Split Ratio for desktop */
        <div id="general-dashboard" className="flex-1 flex flex-col">
          
          <main id="dashboard-scrolled-deck" className="flex-1 w-full mx-auto p-6 md:p-8 flex flex-col lg:flex-row gap-8 overflow-y-auto">
            {/* Left Section: Upload & Controls (Column 8/12 on large viewports) */}
            <section id="uploader-column" className="lg:w-8/12 flex flex-col gap-6">
              
              {/* Tab Selector */}
              <div id="mode-tab-bar" className="flex bg-slate-200/50 p-1 border border-slate-200">
                <button
                  id="tab-audio-mode"
                  type="button"
                  onClick={() => {
                    setActiveTab("audio");
                    setErrorStatus(null);
                  }}
                  className={`flex-1 py-3 text-xs font-bold font-display uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
                    activeTab === "audio"
                      ? "bg-white text-indigo-700 shadow-sm border border-slate-200"
                      : "text-slate-550 hover:text-slate-800"
                  }`}
                >
                  <FileAudio className="w-4 h-4" />
                  Audio Voice Track
                </button>
                <button
                  id="tab-text-mode"
                  type="button"
                  onClick={() => {
                    setActiveTab("text");
                    setErrorStatus(null);
                  }}
                  className={`flex-1 py-3 text-xs font-bold font-display uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all ${
                    activeTab === "text"
                      ? "bg-white text-indigo-700 shadow-sm border border-slate-200"
                      : "text-slate-550 hover:text-slate-800"
                  }`}
                >
                  <Sparkles className="w-4 h-4 text-indigo-600 animate-pulse" />
                  Direct Text Script
                </button>
              </div>              {cookieBlockedAlert ? (
                <div className="relative bg-amber-50/30 border border-amber-250 p-8 md:p-12 text-center animate-fade-in flex flex-col items-center">
                  {/* Decorative Geometric Elements */}
                  <div className="absolute top-0 left-0 w-12 h-12 border-t-2 border-l-2 border-amber-200"></div>
                  <div className="absolute bottom-0 right-0 w-12 h-12 border-b-2 border-r-2 border-amber-200"></div>
                  
                  <div className="w-16 h-16 bg-amber-100/75 rounded-full flex items-center justify-center mb-6 text-amber-700">
                    <AlertCircle className="w-8 h-8" />
                  </div>
                  
                  <h3 className="text-lg md:text-xl font-bold font-display text-slate-800 mb-2">
                    Sandbox Session Authorization Blocked
                  </h3>
                  <p className="text-slate-600 text-xs md:text-sm max-w-md mx-auto leading-relaxed mb-8 font-medium">
                    Your browser's security settings are blocking third-party session cookies inside this embedded iframe. 
                    Because ScribeSync utilizes secure user session handles to authenticate speech transcribers and script workflows, the system cannot receive your file payload in this context.
                  </p>

                  <div className="w-full max-w-sm bg-white border border-slate-200 p-4 rounded text-left flex flex-col gap-2.5 mb-8 text-xs font-medium text-slate-600">
                    <div className="flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-indigo-50 border border-indigo-150 flex items-center justify-center shrink-0 font-bold text-indigo-700 text-[10px]">1</span>
                      <p>Click the <strong>Open in New Tab</strong> button to bypass iframe sandboxing limits.</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-indigo-50 border border-indigo-150 flex items-center justify-center shrink-0 font-bold text-indigo-700 text-[10px]">2</span>
                      <p>The app will load cleanly under a secure first-party browser context.</p>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="w-5 h-5 rounded-full bg-indigo-50 border border-indigo-150 flex items-center justify-center shrink-0 font-bold text-indigo-700 text-[10px]">3</span>
                      <p>Upload files or enter direct script copy for zero-latency transcription!</p>
                    </div>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row items-center gap-3">
                    <a 
                      href={window.location.href} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-3 px-6 rounded-lg shadow-lg shadow-indigo-100 transition transform active:scale-95 cursor-pointer"
                    >
                      Open in New Tab
                      <ArrowUpRight className="w-4 h-4" />
                    </a>
                    <button 
                      type="button"
                      onClick={() => fetchTasks()}
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 font-bold text-xs py-3 px-5 rounded-lg transition active:scale-95 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Retry Connection
                    </button>
                  </div>
                </div>
              ) : activeTab === "audio" ? (
                <>
                  <div className="relative bg-white border border-slate-200 p-8 md:p-12 shadow-xs flex flex-col items-center justify-center text-center">
                    {/* Decorative Geometric Elements */}
                    <div className="absolute top-0 left-0 w-16 h-16 border-t-2 border-l-2 border-slate-200"></div>
                    <div className="absolute bottom-0 right-0 w-16 h-16 border-b-2 border-r-2 border-slate-200"></div>
                    
                    <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mb-6">
                      <Upload className="w-10 h-10 text-indigo-600" />
                    </div>
                    
                    <h2 className="text-xl md:text-2xl font-bold font-display text-slate-800 mb-2">Drop your audio file here</h2>
                    <p className="text-slate-500 mb-8 max-w-sm text-sm font-medium leading-relaxed">
                      Upload any standard file formats (MP3, WAV, M4A, FLAC). High-precision AI engine handles transcription and schedules aligned captions.
                    </p>

                    {/* Box Drag Zone trigger area */}
                    <div 
                      id="draggable-audio-box"
                      onDragEnter={handleDrag}
                      onDragOver={handleDrag}
                      onDragLeave={handleDrag}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`border border-dashed rounded-lg p-6 w-full max-w-md mx-auto cursor-pointer transition-colors ${
                        dragActive 
                          ? "border-indigo-600 bg-indigo-50/30 font-medium" 
                          : selectedFile 
                            ? "border-emerald-500 bg-emerald-50/10" 
                            : "border-slate-300 bg-slate-50/40 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        ref={fileInputRef}
                        id="native-audio-selector"
                        type="file"
                        accept="audio/*"
                        onChange={handleFormChange}
                        className="hidden"
                      />

                      {selectedFile ? (
                        <div className="flex flex-col items-center gap-2">
                          <div className="w-10 h-10 rounded-sm bg-emerald-50 text-emerald-600 flex items-center justify-center shadow-xs">
                            <FileAudio className="w-6 h-6 animate-pulse" />
                          </div>
                          <div className="flex flex-col gap-0.5 truncate max-w-xs">
                            <h4 className="text-xs font-bold text-slate-800 truncate">
                              {selectedFile.name}
                            </h4>
                            <p className="text-[10px] font-mono text-slate-400">
                              {renderSizeLabel(selectedFile.size)}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-xs font-bold text-indigo-655 hover:text-indigo-700">Browse files from system</span>
                          <p className="text-[10px] text-slate-400 font-mono tracking-wider font-semibold uppercase mt-0.5">
                            MP3, WAV, M4A OR FLAC (COMPRESS LARGE FILES!)
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Secure Badge */}
                    <div className="mt-8 text-[10px] font-mono text-slate-400 uppercase tracking-widest font-semibold">
                      Secure • End-to-End Encrypted • Real-time Sync
                    </div>
                  </div>

                  {/* In-Browser Audio Compressor & Optimizer Section */}
                  {selectedFile && (
                    <div className="bg-white border border-slate-200 p-6 shadow-xs relative text-left">
                      {/* Geometric border decorative lines */}
                      <div className="absolute top-0 left-0 w-6 h-6 border-t-2 border-l-2 border-slate-200"></div>
                      <div className="absolute bottom-0 right-0 w-6 h-6 border-b-2 border-r-2 border-slate-200"></div>
                      
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-655 shrink-0">
                          <Sparkles className="w-5 h-5 animate-pulse text-indigo-650" />
                        </div>
                        <div className="flex-1">
                          <h4 className="text-sm font-bold text-slate-800 tracking-tight font-display flex items-center gap-2">
                            Client-Side Audio Optimizer & Compressor
                            {wasCompressed && (
                              <span className="bg-emerald-50 text-emerald-600 border border-emerald-150 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase font-mono tracking-wider animate-bounce">
                                Optimized & Ready
                              </span>
                            )}
                          </h4>
                          <p className="text-xs text-slate-500 font-medium leading-relaxed mt-1">
                            Resamples speech to mono 16kHz WAV format in-browser using Web Audio context. Reduces file size up to 10 times with zero speech quality loss, speeding up transcription processing and fully complying with server boundaries.
                          </p>

                          {/* Compression Progress Feedback */}
                          {compressionProgress && (
                            <div className="mt-4 p-4 bg-indigo-50/30 border border-indigo-100 rounded-lg">
                              <div className="flex justify-between items-center mb-1 text-xs font-bold text-indigo-850">
                                <span className="flex items-center gap-1.5">
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                                  {compressionProgress.message}
                                </span>
                                <span className="font-mono">{compressionProgress.progress}%</span>
                              </div>
                              <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden mt-2 relative">
                                <div 
                                  className="bg-indigo-600 h-full transition-all duration-300" 
                                  style={{ width: `${compressionProgress.progress}%` }}
                                />
                              </div>
                            </div>
                          )}

                          {/* Display before/after compression stats if completed */}
                          {wasCompressed && originalSize && (
                            <div className="mt-4 p-3 bg-emerald-50/50 border border-emerald-100 rounded-lg flex items-center justify-between text-xs font-semibold text-emerald-805 font-mono">
                              <span className="flex items-center gap-1.5">
                                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                File Compressed Successfully!
                              </span>
                              <span>
                                {renderSizeLabel(originalSize)} ➔{" "}
                                <span className="font-extrabold text-emerald-700">
                                  {renderSizeLabel(selectedFile.size)}
                                </span>{" "}
                                ({((1 - selectedFile.size / originalSize) * 100).toFixed(0)}% lighter)
                              </span>
                            </div>
                          )}

                          {/* Compression Launch triggers */}
                          {!wasCompressed && !compressionProgress && (
                            <div className="mt-4 flex flex-col sm:flex-row gap-3">
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    setErrorStatus(null);
                                    const compressedFile = await compressAudio(selectedFile, (p) => {
                                      setCompressionProgress(p);
                                    });
                                    setSelectedFile(compressedFile);
                                    setWasCompressed(true);
                                    setCompressionProgress(null);
                                    if (uploadedFileUrl) {
                                      URL.revokeObjectURL(uploadedFileUrl);
                                    }
                                    const url = URL.createObjectURL(compressedFile);
                                    setUploadedFileUrl(url);
                                  } catch (err: any) {
                                    setErrorStatus(err.message || "Failed to compress audio file.");
                                    setCompressionProgress(null);
                                  }
                                }}
                                className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs py-2 px-4 rounded border border-indigo-150 transition self-start flex items-center gap-1.5 cursor-pointer"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                                Compress & Optimize Audio
                              </button>
                              
                              {/* Alerts if file is over 25MB and require compressor */}
                              {selectedFile.size > 25 * 1024 * 1024 && (
                                <span className="text-[11px] text-rose-500 font-bold self-center flex items-center gap-1">
                                  <AlertCircle className="w-3.5 h-3.5" />
                                  Required: File exceeds 25MB. Compress before clicking submit.
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Action Upload Handlers */}
                  {selectedFile && (
                    <div className="flex gap-3 shrink-0">
                      <button
                        id="cancel-selected-btn"
                        onClick={() => {
                          setSelectedFile(null);
                          setUploadedFileUrl(null);
                          setWasCompressed(false);
                          setOriginalSize(null);
                          setCompressionProgress(null);
                        }}
                        className="flex-1 bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 font-bold text-xs py-3 rounded-lg transition shrink-0"
                      >
                        Clear Audio File
                      </button>
                      <button
                        id="submit-transcribe-btn"
                        onClick={handleTriggerUpload}
                        disabled={isCurrentlyUploading || selectedFile.size > 25 * 1024 * 1024}
                        className="flex-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs py-3 px-6 rounded-lg shadow-lg shadow-indigo-100 transition transform active:scale-95 flex items-center justify-center gap-2"
                      >
                        {isCurrentlyUploading ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Transcribing...
                          </>
                        ) : selectedFile.size > 25 * 1024 * 1024 ? (
                          <>
                            <AlertCircle className="w-4 h-4" />
                            Compress File to Continue (Over 25MB)
                          </>
                        ) : (
                          <>
                            <Languages className="w-4 h-4" />
                            Generate Subtitle Now
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="relative bg-white border border-slate-200 p-8 md:p-10 shadow-xs flex flex-col text-left">
                  {/* Decorative Geometric Elements */}
                  <div className="absolute top-0 left-0 w-12 h-12 border-t-2 border-l-2 border-slate-200 pointer-events-none"></div>
                  <div className="absolute bottom-0 right-0 w-12 h-12 border-b-2 border-r-2 border-slate-200 pointer-events-none"></div>
                  
                  <div className="flex items-center gap-3 border-b border-slate-100 pb-4 mb-6">
                    <div className="w-10 h-10 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600">
                      <Sparkles className="w-5 h-5 animate-pulse" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold font-display text-slate-800">Convert Script into Cinematic Story</h3>
                      <p className="text-xs text-slate-400 font-medium">Input dialogue or narrative text directly to construct subtitles and video prompts</p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5 w-full">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-455 font-mono">Dialogue / Text Story Script</label>
                    <textarea
                      id="direct-script-input"
                      value={directTextInput}
                      onChange={(e) => setDirectTextInput(e.target.value)}
                      placeholder="Type or paste your story monologue here. For example:
In a quiet ancient forest, a single glowing butterly lands on a stone sculpture. Suddenly, the sculpture cracks and wild emerald ivy springs forth from the dust..."
                      rows={8}
                      className="w-full text-xs p-4 border border-slate-250 bg-slate-50/50 outline-none focus:bg-white font-sans text-slate-800 resize-none leading-relaxed shadow-inner"
                    />
                  </div>

                  <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <p className="text-[10px] text-slate-400 font-mono uppercase tracking-wider max-w-sm leading-normal">
                      The AI assistant will segment the sentences into sequential captions, matching each segment to structured Imagen AI prompts.
                    </p>
                    <button
                      id="submit-text-prompt-btn"
                      type="button"
                      onClick={handleTriggerTextSubmit}
                      disabled={isCurrentlyUploading || !directTextInput.trim()}
                      className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs py-3 px-6 rounded-lg shadow-lg shadow-indigo-100 transition transform active:scale-95 flex items-center justify-center gap-2 shrink-0 cursor-pointer"
                    >
                      {isCurrentlyUploading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Converting Script...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          Convert & Build Prompts
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Client error messaging block */}
              {errorStatus && (
                <div className="p-4 bg-rose-50 border border-rose-100 rounded-lg flex gap-3 text-left">
                  <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-1">
                    <h4 className="text-xs font-bold text-rose-800 font-display">Operation Refused</h4>
                    <p className="text-xs leading-relaxed text-rose-600 font-medium">
                      {errorStatus}
                    </p>
                  </div>
                </div>
              )}

              {/* Transcription Settings (Geometric Block from theme, interactive state triggers) */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
                <div className="bg-white border border-slate-200 p-4 transition hover:border-slate-300">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 font-mono">Language</label>
                  <select 
                    value={selectedLanguage}
                    onChange={(e) => setSelectedLanguage(e.target.value)}
                    className="w-full text-xs font-bold text-slate-800 bg-transparent border-none p-0 focus:ring-0 outline-none"
                  >
                    <option>English (Auto-detect)</option>
                    <option>Spanish (Español)</option>
                    <option>French (Français)</option>
                    <option>German (Deutsch)</option>
                    <option>Japanese (日本語)</option>
                  </select>
                </div>
                
                <div className="bg-white border border-slate-200 p-4 transition hover:border-slate-300">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 font-mono">Export Format</label>
                  <select 
                    value={preferredFormat}
                    onChange={(e) => setPreferredFormat(e.target.value)}
                    className="w-full text-xs font-bold text-slate-800 bg-transparent border-none p-0 focus:ring-0 outline-none"
                  >
                    <option>.SRT (Subtitles)</option>
                    <option>.VTT (Web)</option>
                    <option>.JSON (Raw segments)</option>
                    <option>.TXT (Transcript)</option>
                  </select>
                </div>

                <div className="bg-white border border-slate-200 p-4 transition hover:border-slate-300">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1 font-mono">Time Stamps</label>
                  <div 
                    onClick={() => setTimestampsEnabled(!timestampsEnabled)}
                    className="flex items-center gap-2 mt-1 cursor-pointer select-none"
                  >
                    <div className={`w-8 h-4 rounded-full relative transition-colors ${timestampsEnabled ? "bg-indigo-600" : "bg-slate-300"}`}>
                      <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${timestampsEnabled ? "right-0.5" : "left-0.5"}`}></div>
                    </div>
                    <span className="text-xs font-bold text-slate-655">{timestampsEnabled ? "Enabled" : "Disabled"}</span>
                  </div>
                </div>
              </div>

            </section>

            {/* Right Section: History & Status (Column 4/12 on large viewports) */}
            <aside id="history-column" className="lg:w-4/12 flex flex-col bg-white border border-slate-200 shadow-3xs">
              
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-slate-800 font-display">Recent Activity</h3>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 bg-slate-100 text-[10px] font-bold rounded uppercase tracking-wider text-slate-655 shrink-0">
                    {tasks.length} Files
                  </span>
                  <button
                    id="refresh-tasks-aside-btn"
                    onClick={fetchTasks}
                    className="p-1 hover:bg-slate-100 rounded-full text-slate-400 hover:text-indigo-600 transition"
                    title="Reload Workspace History"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Infinite task feed container */}
              <div className="flex-1 overflow-y-auto min-h-[300px]">
                {tasks.length === 0 ? (
                  <div className="p-10 text-center flex flex-col items-center justify-center gap-4 h-full text-slate-400">
                    <div className="w-12 h-12 bg-slate-50 border border-slate-200 rounded flex items-center justify-center text-slate-400">
                      <Music className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-700">No recent activity</h4>
                      <p className="text-[11px] text-slate-400 mt-1 max-w-xs mx-auto leading-relaxed">
                        Attach a track. Completed sound alignments appear securely in this board.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div>
                    {tasks.map((task) => {
                      const isWorking = task.status === "uploading" || task.status === "transcribing";
                      return (
                        <div
                          key={task.id}
                          id={`aside-task-${task.id}`}
                          onClick={() => handleLoadTask(task)}
                          className={`p-6 border-b border-slate-100 cursor-pointer transition-colors hover:bg-slate-50/50 ${
                            activeTask?.id === task.id ? "bg-indigo-50/20" : ""
                          }`}
                        >
                          <div className="flex justify-between items-start mb-2 gap-3">
                            <div className="font-semibold text-xs text-slate-805 truncate flex-1 pr-1 font-display hover:text-indigo-650" title={task.originalName}>
                              {task.originalName}
                            </div>
                            
                            {/* Interactive progress / badge indicator */}
                            {isWorking ? (
                              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded animate-pulse">
                                {task.status === "uploading" ? "35%" : "85%"}
                              </span>
                            ) : (
                              renderBadgeStatus(task.status)
                            )}
                          </div>

                          {isWorking ? (
                            <div className="w-full bg-slate-100 h-1 rounded-full mb-3 overflow-hidden">
                              <div className={`bg-indigo-600 h-full transition-all duration-1000 ${task.status === "uploading" ? "w-[35%]" : "w-[85%]"}`}></div>
                            </div>
                          ) : (
                            <div className="text-[11px] text-slate-455 mb-3 font-medium">
                              {task.status === "completed" ? "Ready" : "Failed"} • {renderSizeLabel(task.fileSize)} • {new Date(task.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}

                          {task.status === "completed" && (
                            <button 
                              id={`load-task-btn-${task.id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleLoadTask(task);
                              }}
                              className="w-full py-2 bg-white hover:bg-slate-50 border border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-600 transition"
                            >
                              Launch Subtitle Workspace
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Dynamic Sandbox Storage Indicator */}
              <div className="p-6 bg-slate-50 border-t border-slate-100 shrink-0 select-none">
                <div className="flex justify-between text-[11px] font-bold text-slate-400 mb-2 uppercase tracking-wider font-mono">
                  <span>Workspace Sandbox Space</span>
                  <span className="font-mono">{renderSizeLabel(totalBytesInSandbox)} / 5 GB</span>
                </div>
                <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className="bg-indigo-650 h-full transition-all duration-500" 
                    style={{ width: `${Math.max(2, storagePercentage)}%` }}
                  ></div>
                </div>
              </div>

            </aside>

          </main>

        </div>
      )}

      {/* Footer Bar */}
      <footer id="global-footer" className="h-10 bg-slate-100 border-t border-slate-200 px-6 md:px-8 flex items-center justify-between shrink-0 font-mono text-[10px] text-slate-400 uppercase tracking-widest leading-none mt-auto">
        <div>
          Status: <span className="text-emerald-600 font-bold">Systems Operational</span>
        </div>
        <div>
          © 2026 ScribeSync Global Labs
        </div>
      </footer>

    </div>
  );
}
