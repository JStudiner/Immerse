/**
 * Immersion v2 - Scene Analyzer Module (Gemini Vision)
 * 
 * Analyzes video frames to extract visual context for beginner content.
 * Uses Google Gemini Vision to identify:
 * - Key objects and people in the scene
 * - Actions being performed
 * - Visual context that supports language learning
 * - Teachable moments (pointing, gestures, visual cues)
 * 
 * This enables Dreaming Spanish-style beginner content where visuals
 * support comprehension even for absolute beginners.
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Common beginner vocabulary (A1 level) - things learners should recognize
const A1_VOCABULARY = {
  objects: [
    "perro", "gato", "casa", "coche", "libro", "mesa", "silla", "teléfono",
    "computadora", "agua", "comida", "pan", "fruta", "manzana", "naranja",
    "árbol", "flor", "sol", "luna", "puerta", "ventana", "cama", "ropa",
  ],
  people: [
    "hombre", "mujer", "niño", "niña", "persona", "amigo", "familia",
    "madre", "padre", "hermano", "hermana", "bebé",
  ],
  actions: [
    "caminar", "correr", "comer", "beber", "hablar", "mirar", "escuchar",
    "sentarse", "estar de pie", "dormir", "trabajar", "jugar", "leer",
    "escribir", "cocinar", "conducir", "bailar", "cantar", "reír", "llorar",
  ],
  colors: [
    "rojo", "azul", "verde", "amarillo", "negro", "blanco", "naranja",
    "rosa", "morado", "marrón", "gris",
  ],
  locations: [
    "casa", "escuela", "tienda", "calle", "parque", "playa", "montaña",
    "ciudad", "oficina", "cocina", "baño", "habitación", "jardín",
  ],
};

/**
 * Extract frames from video at specified timestamps
 * 
 * @param {string} videoPath - Path to video file
 * @param {array} timestamps - Array of timestamps in seconds
 * @param {string} outputDir - Directory to save frames
 * @returns {array} Array of { timestamp, framePath }
 */
function extractFrames(videoPath, timestamps, outputDir) {
  const framesDir = path.join(outputDir, "frames");
  fs.mkdirSync(framesDir, { recursive: true });

  const frames = [];

  for (const ts of timestamps) {
    const framePath = path.join(framesDir, `frame_${ts.toFixed(2).replace('.', '_')}.jpg`);
    
    try {
      // Extract frame at timestamp with good quality
      execSync(
        `ffmpeg -y -ss ${ts} -i "${videoPath}" -vframes 1 -q:v 2 "${framePath}"`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 10000 }
      );

      if (fs.existsSync(framePath)) {
        frames.push({ timestamp: ts, framePath });
      }
    } catch (err) {
      console.log(`   ⚠️ Failed to extract frame at ${ts}s: ${err.message}`);
    }
  }

  return frames;
}

/**
 * Extract frames at regular intervals throughout the video
 * 
 * @param {string} videoPath - Path to video file
 * @param {string} outputDir - Directory to save frames
 * @param {object} options - Extraction options
 * @returns {array} Array of { timestamp, framePath }
 */
function extractFramesAtIntervals(videoPath, outputDir, options = {}) {
  const {
    interval = 5,        // Extract every 5 seconds
    maxFrames = 100,     // Limit total frames
    startTime = 0,
    endTime = null,
  } = options;

  // Get video duration
  let duration;
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      { encoding: "utf-8", timeout: 10000 }
    );
    duration = parseFloat(result.trim());
  } catch {
    duration = 300; // Default 5 minutes
  }

  const end = endTime || duration;
  const timestamps = [];
  
  for (let t = startTime; t < end && timestamps.length < maxFrames; t += interval) {
    timestamps.push(t);
  }

  console.log(`   📷 Extracting ${timestamps.length} frames (every ${interval}s)...`);
  return extractFrames(videoPath, timestamps, outputDir);
}

/**
 * Analyze a single frame with Gemini Vision
 * 
 * @param {string} framePath - Path to frame image
 * @param {object} options - Analysis options
 * @returns {Promise<object>} Analysis result
 */
async function analyzeFrame(framePath, options = {}) {
  const {
    targetLanguage = "spanish",
    level = "A1",
    includeVocabulary = true,
  } = options;

  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set!");
  }

  // Read image file
  const imageData = fs.readFileSync(framePath);
  const base64Image = imageData.toString("base64");
  const mimeType = "image/jpeg";

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
    },
  });

  const prompt = `Analyze this video frame for a ${level} ${targetLanguage} language learner.

TASK: Identify visual elements that can help teach ${targetLanguage} vocabulary.

Provide:
1. Main objects visible (things a beginner should learn names for)
2. People and their actions (what are they doing?)
3. Setting/location (where is this?)
4. Colors prominently visible
5. Teachable moments (pointing, gestures, clear visual examples)
6. Suggested vocabulary words (${targetLanguage}) that match what's visible

IMPORTANT: Focus on CONCRETE, VISUAL things that a beginner can understand by seeing.
Avoid abstract concepts. Prioritize common everyday vocabulary.

Return JSON:
{
  "objects": [{"name_${targetLanguage}": "perro", "name_english": "dog", "prominent": true}],
  "people": [{"description_${targetLanguage}": "un hombre", "action_${targetLanguage}": "está hablando", "action_english": "is talking"}],
  "location": {"name_${targetLanguage}": "cocina", "name_english": "kitchen"},
  "colors": ["rojo", "azul"],
  "teachableMoments": [{"type": "pointing", "target": "libro", "description": "person pointing at book"}],
  "suggestedVocabulary": [
    {"word": "perro", "translation": "dog", "context": "visible in frame", "difficulty": "A1"}
  ],
  "sceneDescription_${targetLanguage}": "Un hombre está en la cocina con un perro.",
  "sceneDescription_english": "A man is in the kitchen with a dog."
}`;

  const result = await model.generateContent([
    { text: prompt },
    {
      inlineData: {
        mimeType,
        data: base64Image,
      },
    },
  ]);

  const responseText = result.response.text().trim();
  
  // Parse JSON response
  let jsonStr = responseText;
  if (responseText.includes("```")) {
    const match = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) jsonStr = match[1].trim();
  }

  try {
    return JSON.parse(jsonStr);
  } catch (parseErr) {
    console.log(`   ⚠️ Failed to parse frame analysis: ${parseErr.message}`);
    return {
      objects: [],
      people: [],
      location: null,
      colors: [],
      teachableMoments: [],
      suggestedVocabulary: [],
      sceneDescription_spanish: "",
      sceneDescription_english: "",
      parseError: true,
    };
  }
}

/**
 * Analyze multiple frames and build a vocabulary timeline
 * 
 * @param {array} frames - Array of { timestamp, framePath }
 * @param {object} options - Analysis options
 * @returns {Promise<object>} Analysis results with vocabulary timeline
 */
async function analyzeFrames(frames, options = {}) {
  const {
    concurrency = 3,
    targetLanguage = "spanish",
    level = "A1",
  } = options;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`👁️ SCENE ANALYSIS: Gemini Vision`);
  console.log(`${"═".repeat(60)}`);
  console.log(`   Frames to analyze: ${frames.length}`);
  console.log(`   Target language: ${targetLanguage}`);
  console.log(`   Level: ${level}`);

  const startTime = Date.now();
  const results = [];
  const vocabularyMap = new Map(); // Track vocabulary across frames

  // Process frames in parallel batches
  for (let i = 0; i < frames.length; i += concurrency) {
    const batch = frames.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(async (frame) => {
        try {
          const analysis = await analyzeFrame(frame.framePath, {
            targetLanguage,
            level,
          });

          return {
            timestamp: frame.timestamp,
            framePath: frame.framePath,
            analysis,
          };
        } catch (err) {
          console.log(`   ⚠️ Frame ${frame.timestamp}s: ${err.message}`);
          return {
            timestamp: frame.timestamp,
            framePath: frame.framePath,
            analysis: null,
            error: err.message,
          };
        }
      })
    );

    results.push(...batchResults);

    // Track vocabulary appearances
    for (const r of batchResults) {
      if (r.analysis?.suggestedVocabulary) {
        for (const vocab of r.analysis.suggestedVocabulary) {
          const key = vocab.word?.toLowerCase();
          if (!key) continue;
          
          if (!vocabularyMap.has(key)) {
            vocabularyMap.set(key, {
              word: vocab.word,
              translation: vocab.translation,
              difficulty: vocab.difficulty,
              appearances: [],
            });
          }
          vocabularyMap.get(key).appearances.push({
            timestamp: r.timestamp,
            context: vocab.context,
          });
        }
      }
    }

    console.log(`   Progress: ${Math.min(i + concurrency, frames.length)}/${frames.length} frames`);
  }

  // Build vocabulary timeline (sorted by frequency)
  const vocabularyTimeline = Array.from(vocabularyMap.values())
    .sort((a, b) => b.appearances.length - a.appearances.length);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const successCount = results.filter(r => r.analysis && !r.error).length;

  console.log(`\n   ✅ SCENE ANALYSIS COMPLETE in ${elapsed}s`);
  console.log(`   📊 Analyzed: ${successCount}/${frames.length} frames`);
  console.log(`   📚 Vocabulary items: ${vocabularyTimeline.length}`);

  // Show top vocabulary
  if (vocabularyTimeline.length > 0) {
    console.log(`\n   🔤 Top Vocabulary (by frequency):`);
    vocabularyTimeline.slice(0, 10).forEach((v, i) => {
      console.log(`      ${i + 1}. ${v.word} (${v.translation}) - ${v.appearances.length} appearances`);
    });
  }

  return {
    frames: results,
    vocabularyTimeline,
    stats: {
      framesAnalyzed: successCount,
      totalFrames: frames.length,
      uniqueVocabulary: vocabularyTimeline.length,
      processingTime: parseFloat(elapsed),
    },
  };
}

/**
 * Main function: Analyze video for beginner content generation
 * 
 * @param {string} videoPath - Path to video file
 * @param {string} outputDir - Output directory
 * @param {object} options - Analysis options
 * @returns {Promise<object>} Complete scene analysis
 */
async function analyzeVideoForBeginnerContent(videoPath, outputDir, options = {}) {
  const {
    frameInterval = 5,    // Analyze every 5 seconds
    maxFrames = 60,       // Max 60 frames (5 min video)
    targetLanguage = "spanish",
    level = "A1",
    segments = null,      // Optional: align with transcription segments
  } = options;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎬 BEGINNER CONTENT ANALYSIS`);
  console.log(`${"═".repeat(60)}`);
  console.log(`   Video: ${path.basename(videoPath)}`);
  console.log(`   Output: ${outputDir}`);

  // Determine timestamps to analyze
  let timestamps;
  
  if (segments && segments.length > 0) {
    // Extract frames at segment midpoints for better alignment
    timestamps = segments.map(seg => (seg.start + seg.end) / 2);
    console.log(`   Using ${timestamps.length} segment-aligned timestamps`);
  } else {
    // Extract at regular intervals
    timestamps = [];
    for (let t = 0; timestamps.length < maxFrames; t += frameInterval) {
      timestamps.push(t);
    }
    console.log(`   Using ${timestamps.length} interval timestamps (every ${frameInterval}s)`);
  }

  // Extract frames
  const frames = extractFrames(videoPath, timestamps.slice(0, maxFrames), outputDir);
  console.log(`   Extracted ${frames.length} frames`);

  // Analyze frames
  const analysis = await analyzeFrames(frames, {
    concurrency: 3,
    targetLanguage,
    level,
  });

  // If segments provided, align vocabulary with segments
  if (segments && segments.length > 0) {
    analysis.segmentVocabulary = alignVocabularyWithSegments(
      analysis.frames,
      segments
    );
  }

  // Save analysis results
  const analysisPath = path.join(outputDir, "scene_analysis.json");
  fs.writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));
  console.log(`   💾 Saved analysis to scene_analysis.json`);

  return analysis;
}

/**
 * Align vocabulary with transcription segments
 * 
 * @param {array} frameAnalyses - Array of frame analysis results
 * @param {array} segments - Transcription segments
 * @returns {array} Segments with aligned vocabulary
 */
function alignVocabularyWithSegments(frameAnalyses, segments) {
  return segments.map(seg => {
    // Find frames that fall within this segment's time range
    const relevantFrames = frameAnalyses.filter(f => 
      f.timestamp >= seg.start && f.timestamp <= seg.end && f.analysis
    );

    // Collect vocabulary from relevant frames
    const vocabulary = [];
    const seen = new Set();
    
    for (const frame of relevantFrames) {
      if (frame.analysis?.suggestedVocabulary) {
        for (const vocab of frame.analysis.suggestedVocabulary) {
          if (!seen.has(vocab.word?.toLowerCase())) {
            seen.add(vocab.word?.toLowerCase());
            vocabulary.push(vocab);
          }
        }
      }
    }

    return {
      segmentIndex: seg.index,
      start: seg.start,
      end: seg.end,
      text: seg.text,
      vocabulary,
      sceneDescriptions: relevantFrames
        .filter(f => f.analysis?.sceneDescription_spanish)
        .map(f => ({
          timestamp: f.timestamp,
          spanish: f.analysis.sceneDescription_spanish,
          english: f.analysis.sceneDescription_english,
        })),
    };
  });
}

/**
 * Generate vocabulary flashcard data from scene analysis
 * 
 * @param {object} analysis - Scene analysis result
 * @param {object} options - Generation options
 * @returns {array} Flashcard data
 */
function generateVocabularyFlashcards(analysis, options = {}) {
  const {
    maxCards = 50,
    minAppearances = 1,
    prioritizeA1 = true,
  } = options;

  let vocabulary = analysis.vocabularyTimeline
    .filter(v => v.appearances.length >= minAppearances);

  // Prioritize A1 vocabulary
  if (prioritizeA1) {
    vocabulary = vocabulary.sort((a, b) => {
      const aIsA1 = a.difficulty === "A1" ? 0 : 1;
      const bIsA1 = b.difficulty === "A1" ? 0 : 1;
      if (aIsA1 !== bIsA1) return aIsA1 - bIsA1;
      return b.appearances.length - a.appearances.length;
    });
  }

  return vocabulary.slice(0, maxCards).map((v, i) => ({
    id: i,
    word: v.word,
    translation: v.translation,
    difficulty: v.difficulty,
    appearances: v.appearances.length,
    firstAppearance: v.appearances[0]?.timestamp || 0,
    contexts: v.appearances.map(a => a.context).filter(Boolean),
  }));
}

module.exports = {
  extractFrames,
  extractFramesAtIntervals,
  analyzeFrame,
  analyzeFrames,
  analyzeVideoForBeginnerContent,
  alignVocabularyWithSegments,
  generateVocabularyFlashcards,
  A1_VOCABULARY,
};
