import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Set up JSON body parser with increased limit just in case
app.use(express.json({ limit: "50mb" }));

// Configure Multer for files upload in the server OS temp directory
const upload = multer({ 
  dest: os.tmpdir(),
  limits: { fileSize: 200 * 1024 * 1024 } // 200 MB limit
});

// Lazy-initialized Gemini client
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required. Please set it in Settings > Secrets.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        }
      }
    });
  }
  return aiClient;
}

// In-memory Task storage
interface Task {
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
    json: any[];
    transcript: string;
  };
  error?: string;
  timestamp: string;
}

const tasks: Record<string, Task> = {};

// Helper: formats seconds float into subtitle timestamps
function formatSeconds(secs: number, isVtt = false): string {
  if (isNaN(secs) || secs < 0) secs = 0;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const ms = Math.floor((secs % 1) * 1000);

  const pad = (num: number, size = 2) => String(num).padStart(size, "0");
  const msDelim = isVtt ? "." : ",";

  return `${pad(h)}:${pad(m)}:${pad(s)}${msDelim}${pad(ms, 3)}`;
}

// Helper: converts schema JSON segments array back to SRT or VTT block
function buildSrtString(segments: any[]): string {
  return segments
    .map((seg, idx) => {
      const startStr = formatSeconds(seg.start, false);
      const endStr = formatSeconds(seg.end, false);
      return `${idx + 1}\n${startStr} --> ${endStr}\n${seg.text}\n`;
    })
    .join("\n");
}

function buildVttString(segments: any[]): string {
  const blocks = segments.map((seg, idx) => {
    const startStr = formatSeconds(seg.start, true);
    const endStr = formatSeconds(seg.end, true);
    return `${startStr} --> ${endStr}\n${seg.text}\n`;
  });
  return `WEBVTT\n\n` + blocks.join("\n");
}

// REST API Endpoints

// Get lists of all tasks
app.get("/api/tasks", (req, res) => {
  const list = Object.values(tasks).map(({ result, ...rest }) => rest);
  res.json(list.reverse());
});

// Get detailed task status
app.get("/api/tasks/:id", (req, res) => {
  const task = tasks[req.params.id];
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  res.json(task);
});

// Upload audio to start subtitle transcription
app.post("/api/upload", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No audio file provided" });
      return;
    }

    // Attempt client fetch to verify key early (lazy evaluation)
    try {
      getGeminiClient();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
      return;
    }

    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const originalName = req.file.originalname;
    const fileSize = req.file.size;
    const localFilePath = req.file.path;
    const mimetype = req.file.mimetype;

    // Create the initial task
    tasks[taskId] = {
      id: taskId,
      status: "uploading",
      originalName,
      fileSize,
      progressMessage: "Initializing upload to Gemini...",
      timestamp: new Date().toISOString()
    };

    // Immediately respond with the task ID
    res.json({ taskId });

    // Begin background processing
    (async () => {
      let uploadResult: any = null;
      try {
        const ai = getGeminiClient();

        // 1. Upload the file to Gemini File API
        tasks[taskId].progressMessage = "Uploading audio file to Gemini Secure API...";
        updateTask(taskId);

        // Uploading via standard path
        uploadResult = await ai.files.upload({
          file: localFilePath,
          config: {
            mimeType: mimetype || "audio/mp3",
          }
        });

        console.log(`Uploaded file to Gemini File API: ${uploadResult.name}`);

        // Update task status
        tasks[taskId].status = "transcribing";
        tasks[taskId].progressMessage = "Gemini is analyzing the speech track & transcribing. This might take a dynamic minute depending on audio duration...";
        updateTask(taskId);

        // 2. Call generateContent with structured subtitle schema including visual prompts
        const responseSchema = {
          type: Type.OBJECT,
          properties: {
            language: { 
              type: Type.STRING, 
              description: "The primary language detected in the audio file" 
            },
            transcript: { 
              type: Type.STRING, 
              description: "The full contiguous transcription text of the audio file" 
            },
            segments: {
              type: Type.ARRAY,
              description: "Chronologically sorted array of subtitle captions",
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { 
                    type: Type.INTEGER, 
                    description: "Continuous sequential identifier starting at 1" 
                  },
                  start: { 
                    type: Type.NUMBER, 
                    description: "Decimal float start timestamp of this subtitle segment in seconds" 
                  },
                  end: { 
                    type: Type.NUMBER, 
                    description: "Decimal float end timestamp of this subtitle segment in seconds" 
                  },
                  text: { 
                    type: Type.STRING, 
                    description: "The spoken words/transcript of this caption segment in the original input language" 
                  },
                  visual_prompt: {
                    type: Type.STRING,
                    description: "A corresponding Visual Prompt (strictly in English) describing a scene perfectly matching the subtitle's emotion, context, and meaning. Make it descriptive, cinematic, and detailed (specifying lighting, atmosphere, art style, and subject). Ensure these prompts are continuous so that when generated images are stitched together, they form a cohesive video story."
                  }
                },
                required: ["id", "start", "end", "text", "visual_prompt"]
              }
            }
          },
          required: ["language", "transcript", "segments"]
        };

        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: [
            {
              fileData: {
                fileUri: uploadResult.uri,
                mimeType: uploadResult.mimeType
              }
            },
            "You are an expert AI Video Assistant. Your job is to take this audio track, transcribe its speech to high-quality subtitles, and convert it into a structured format containing both subtitles and detailed, hyper-realistic visual prompts for image generation (to be used in style guides or Gemini/Imagen models). Output each word exactly as spoken. Segment the transcription into concise, conversational, readable caption blocks of around 3 to 12 words, with accurate start and end decimal timestamps matching the voice. Do not skip any phrases. For every subtitle segment, think of the mood, emotion, and meaning, and build a corresponding visual_prompt strictly in English. Make them descriptive, cinematic, and detailed (specify lighting, atmosphere, art style, and subject), and ensure the segments are continuous so that they construct a cohesive storytelling sequence of prompts."
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: responseSchema,
            temperature: 0.15
          }
        });

        const rawText = response.text;
        if (!rawText) {
          throw new Error("Transcriber returned an empty response.");
        }

        let cleanedJson = rawText.trim();
        if (cleanedJson.startsWith("```")) {
          cleanedJson = cleanedJson.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
        }
        const data = JSON.parse(cleanedJson);

        // Sort segments chronologically just in case
        const sortedSegments = (data.segments || []).sort((a: any, b: any) => a.start - b.start);

        // Render standard formats
        const srt = buildSrtString(sortedSegments);
        const vtt = buildVttString(sortedSegments);

        tasks[taskId].status = "completed";
        tasks[taskId].language = data.language || "Unknown";
        tasks[taskId].progressMessage = "Transcription finished successfully!";
        tasks[taskId].result = {
          srt,
          vtt,
          json: sortedSegments,
          transcript: data.transcript || ""
        };
        updateTask(taskId);

      } catch (err: any) {
        console.error("Transcription error:", err);
        tasks[taskId].status = "failed";
        tasks[taskId].error = err.message || "An error occurred during transcription.";
        tasks[taskId].progressMessage = "Failed: " + (err.message || "Unknown error");
        updateTask(taskId);
      } finally {
        // CLEANUPS
        // 1. Delete local file
        try {
          if (fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
            console.log(`Cleaned up local file: ${localFilePath}`);
          }
        } catch (err) {
          console.error("Failed to delete local temp file:", err);
        }

        // 2. Delete file from Gemini API storage
        if (uploadResult && uploadResult.name) {
          try {
            const ai = getGeminiClient();
            await ai.files.delete({ name: uploadResult.name });
            console.log(`Successfully deleted ${uploadResult.name} from Gemini API Cloud`);
          } catch (apiDelErr) {
            console.error("Failed to delete file from Gemini Cloud storage:", apiDelErr);
          }
        }
      }
    })();

  } catch (err: any) {
    console.error("Upload handler error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// Transcribe from direct text input
app.post("/api/transcribe-text", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "No text content provided." });
      return;
    }

    // Attempt client fetch to verify key early (lazy evaluation)
    try {
      getGeminiClient();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
      return;
    }

    const taskId = `task_${Date.now()}_txt_${Math.random().toString(36).substr(2, 9)}`;

    // Create the initial task
    tasks[taskId] = {
      id: taskId,
      status: "transcribing",
      originalName: "Direct Text: " + (text.substring(0, 32) + (text.length > 32 ? "..." : "")),
      fileSize: Buffer.byteLength(text, "utf8"),
      progressMessage: "Converting direct text into structured cinematic narrative...",
      timestamp: new Date().toISOString()
    };

    // Immediately respond with the task ID
    res.json({ taskId });

    // Begin background processing
    (async () => {
      try {
        const ai = getGeminiClient();

        tasks[taskId].progressMessage = "Analyzing text flow & segmenting storylines with prompts...";
        updateTask(taskId);

        const responseSchema = {
          type: Type.OBJECT,
          properties: {
            language: { 
              type: Type.STRING, 
              description: "The primary detected language of the input text" 
            },
            transcript: { 
              type: Type.STRING, 
              description: "The full input text content cleaned" 
            },
            segments: {
              type: Type.ARRAY,
              description: "Chronologically sequenced array of subtitle segments with matching visual prompts",
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { 
                    type: Type.INTEGER, 
                    description: "Continuous sequential identifier starting at 1" 
                  },
                  start: { 
                    type: Type.NUMBER, 
                    description: "Continuous estimated sequential start timestamp of this subtitle segment in seconds. Make sure start <= end and they don't overlap." 
                  },
                  end: { 
                    type: Type.NUMBER, 
                    description: "Continuous estimated sequential end timestamp of this subtitle segment in seconds" 
                  },
                  text: { 
                    type: Type.STRING, 
                    description: "The subtitle text fragment of this segment in its original language (e.g., Bangla or English)" 
                  },
                  visual_prompt: {
                    type: Type.STRING,
                    description: "A corresponding Visual Prompt (strictly in English) describing a scene perfectly matching the segment's emotion, context, and meaning. Make it descriptive, cinematic, and detailed (specifying lighting, atmosphere, art style, and subject). Ensure these prompts are continuous so that when generated images are stitched together, they form a cohesive video story."
                  }
                },
                required: ["id", "start", "end", "text", "visual_prompt"]
              }
            }
          },
          required: ["language", "transcript", "segments"]
        };

        const response = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: [
            `You are an expert AI Video Assistant. Your job is to take the following text input, split it into sequential subtitle/caption frames (split by logical pauses/phrases, about 4 to 12 words per segment), assign them sequential timestamps (e.g. 3 to 6 seconds per segment), and generate a matching descriptive, cinematic visual prompt in English for each segment.

Original Input Text:
"""
${text}
"""`
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: responseSchema,
            temperature: 0.2
          }
        });

        const rawText = response.text;
        if (!rawText) {
          throw new Error("AI Text Assistant returned an empty response.");
        }

        let cleanedJson = rawText.trim();
        if (cleanedJson.startsWith("```")) {
          cleanedJson = cleanedJson.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
        }
        const data = JSON.parse(cleanedJson);

        // Sort segments chronologically
        const sortedSegments = (data.segments || []).sort((a: any, b: any) => a.start - b.start);

        // Render standard formats
        const srt = buildSrtString(sortedSegments);
        const vtt = buildVttString(sortedSegments);

        tasks[taskId].status = "completed";
        tasks[taskId].language = data.language || "Unknown";
        tasks[taskId].progressMessage = "Structured text conversion finished successfully!";
        tasks[taskId].result = {
          srt,
          vtt,
          json: sortedSegments,
          transcript: data.transcript || text
        };
        updateTask(taskId);

      } catch (err: any) {
        console.error("Text structured conversion error:", err);
        tasks[taskId].status = "failed";
        tasks[taskId].error = err.message || "An error occurred during text structured conversion.";
        tasks[taskId].progressMessage = "Failed: " + (err.message || "Unknown error");
        updateTask(taskId);
      }
    })();

  } catch (err: any) {
    console.error("Direct text route crash:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// Helper for task event auditing/logging
function updateTask(id: string) {
  console.log(`Task [${id}] - Status [${tasks[id].status}] - Message: ${tasks[id].progressMessage}`);
}

// Global JSON error handling middleware to prevent HTML error fallbacks
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Express global route server error caught:", err);
  res.status(err.status || 500).json({
    error: err.message || "Internal processing error occurred in full-stack router."
  });
});

async function startServer() {
  // Vite integration for web assets
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Full-stack server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
