/**
 * Types for Audio Subtitle Generator
 */

export interface SubtitleSegment {
  id: number;
  start: number; // in seconds
  end: number;   // in seconds
  text: string;
  visual_prompt?: string;
}

export interface Task {
  id: string;
  status: "uploading" | "transcribing" | "completed" | "failed";
  originalName: string;
  fileSize: number;
  duration?: number;
  progressMessage: string;
  language?: string;
  result?: {
    srt: string;
    vtt: string;
    json: SubtitleSegment[];
    transcript: string;
  };
  error?: string;
  timestamp: string;
}
