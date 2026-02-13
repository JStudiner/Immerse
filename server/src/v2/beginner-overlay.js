/**
 * Immersion v2 - Beginner Overlay Generator
 * 
 * Generates vocabulary overlays for beginner content (Dreaming Spanish style).
 * Creates visual aids that appear on screen to support language comprehension:
 * 
 * - Vocabulary cards: Word + translation + emoji/icon
 * - Word highlighting: Flash the word when spoken
 * - Picture-in-picture: Show related images for abstract concepts
 * - Subtitle enhancements: Color-coded vocabulary in subtitles
 * 
 * Uses FFmpeg's drawtext and overlay filters for video compositing.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Emoji mappings for common beginner vocabulary
const VOCABULARY_EMOJIS = {
  // Animals
  perro: "🐕", gato: "🐱", pájaro: "🐦", pez: "🐟", caballo: "🐴",
  vaca: "🐄", cerdo: "🐷", pollo: "🐔", oveja: "🐑", oso: "🐻",
  
  // Food & Drink
  agua: "💧", comida: "🍽️", pan: "🍞", fruta: "🍎", manzana: "🍎",
  naranja: "🍊", plátano: "🍌", leche: "🥛", café: "☕", cerveza: "🍺",
  vino: "🍷", carne: "🥩", pescado: "🐟", huevo: "🥚", queso: "🧀",
  
  // Objects
  libro: "📚", mesa: "🪑", silla: "🪑", teléfono: "📱", computadora: "💻",
  coche: "🚗", bicicleta: "🚲", casa: "🏠", puerta: "🚪", ventana: "🪟",
  cama: "🛏️", reloj: "⏰", llave: "🔑", dinero: "💰", bolsa: "👜",
  
  // People
  hombre: "👨", mujer: "👩", niño: "👦", niña: "👧", bebé: "👶",
  familia: "👨‍👩‍👧‍👦", amigo: "🤝", doctor: "👨‍⚕️", profesor: "👨‍🏫",
  
  // Places
  escuela: "🏫", tienda: "🏪", restaurante: "🍽️", hospital: "🏥",
  aeropuerto: "✈️", playa: "🏖️", montaña: "⛰️", parque: "🌳",
  
  // Actions (shown as related objects/outcomes)
  comer: "🍽️", beber: "🥤", dormir: "😴", trabajar: "💼", jugar: "🎮",
  leer: "📖", escribir: "✍️", hablar: "🗣️", escuchar: "👂", mirar: "👀",
  caminar: "🚶", correr: "🏃", nadar: "🏊", bailar: "💃", cantar: "🎤",
  
  // Colors
  rojo: "🔴", azul: "🔵", verde: "🟢", amarillo: "🟡", negro: "⚫",
  blanco: "⚪", naranja: "🟠", rosa: "🩷", morado: "🟣",
  
  // Weather & Nature
  sol: "☀️", luna: "🌙", lluvia: "🌧️", nieve: "❄️", nube: "☁️",
  árbol: "🌳", flor: "🌸", mar: "🌊", río: "🏞️",
  
  // Time & Numbers
  hora: "🕐", día: "📅", noche: "🌙", mañana: "🌅", tarde: "🌆",
  uno: "1️⃣", dos: "2️⃣", tres: "3️⃣", cuatro: "4️⃣", cinco: "5️⃣",
  
  // Emotions
  feliz: "😊", triste: "😢", enojado: "😠", sorprendido: "😲", cansado: "😫",
  
  // Body parts
  cabeza: "🧠", mano: "✋", pie: "🦶", ojo: "👁️", corazón: "❤️",
};

// Default overlay styles
const OVERLAY_STYLES = {
  vocabularyCard: {
    backgroundColor: "rgba(0,0,0,0.8)",
    textColor: "white",
    fontSize: 48,
    padding: 20,
    borderRadius: 15,
    position: "bottom-right", // top-left, top-right, bottom-left, bottom-right, center
    margin: 30,
  },
  wordHighlight: {
    backgroundColor: "rgba(255,215,0,0.9)", // Gold
    textColor: "black",
    fontSize: 64,
    fadeInDuration: 0.3,
    holdDuration: 1.5,
    fadeOutDuration: 0.3,
  },
  subtitle: {
    vocabularyColor: "#FFD700", // Gold for vocabulary words
    normalColor: "white",
    backgroundColor: "rgba(0,0,0,0.7)",
    fontSize: 36,
  },
};

/**
 * Generate vocabulary overlay data for a video
 * 
 * @param {array} vocabulary - Array of vocabulary items with timing
 * @param {object} options - Overlay options
 * @returns {array} Overlay specifications for FFmpeg
 */
function generateVocabularyOverlays(vocabulary, options = {}) {
  const {
    style = "card", // "card", "highlight", "subtitle"
    position = "bottom-right",
    maxOverlays = 50,
    minDisplayTime = 2.0,
    fadeInDuration = 0.3,
    fadeOutDuration = 0.3,
  } = options;

  const overlays = [];

  for (const vocab of vocabulary.slice(0, maxOverlays)) {
    const emoji = VOCABULARY_EMOJIS[vocab.word?.toLowerCase()] || "📝";
    const startTime = vocab.timestamp || vocab.firstAppearance || 0;
    const endTime = startTime + Math.max(minDisplayTime, vocab.duration || 2.0);

    overlays.push({
      type: style,
      word: vocab.word,
      translation: vocab.translation,
      emoji,
      startTime,
      endTime,
      fadeInDuration,
      fadeOutDuration,
      position,
      difficulty: vocab.difficulty || "A1",
    });
  }

  // Sort by start time and resolve overlaps
  overlays.sort((a, b) => a.startTime - b.startTime);
  
  // Stagger overlapping overlays
  for (let i = 1; i < overlays.length; i++) {
    const prev = overlays[i - 1];
    const curr = overlays[i];
    
    if (curr.startTime < prev.endTime) {
      // Overlapping - either delay current or shorten previous
      if (prev.endTime - prev.startTime > minDisplayTime + 0.5) {
        prev.endTime = curr.startTime - 0.1;
      } else {
        curr.startTime = prev.endTime + 0.1;
        curr.endTime = curr.startTime + minDisplayTime;
      }
    }
  }

  return overlays;
}

/**
 * Generate enhanced subtitles with vocabulary highlighting
 * 
 * @param {array} segments - Translated segments with vocabulary
 * @param {string} outputPath - Path to save SRT file
 * @param {object} options - Subtitle options
 * @returns {object} Subtitle file info
 */
function generateEnhancedSubtitles(segments, outputPath, options = {}) {
  const {
    vocabularyColor = "#FFD700",
    showTranslation = true,
    showEmoji = true,
    targetLanguage = "spanish",
  } = options;

  let srtContent = "";
  let index = 1;

  for (const seg of segments) {
    if (!seg.translatedText) continue;

    const startTime = formatSrtTime(seg.start);
    const endTime = formatSrtTime(seg.end);

    // Build subtitle text
    let text = seg.translatedText;
    
    // Highlight vocabulary words if present
    if (seg.vocabulary && seg.vocabulary.length > 0) {
      for (const vocab of seg.vocabulary) {
        const emoji = showEmoji ? (VOCABULARY_EMOJIS[vocab.word?.toLowerCase()] || "") : "";
        const highlight = `<font color="${vocabularyColor}">${vocab.word}${emoji ? " " + emoji : ""}</font>`;
        
        // Replace word in text (case-insensitive)
        const regex = new RegExp(`\\b${vocab.word}\\b`, "gi");
        text = text.replace(regex, highlight);
      }
    }

    // Add translation line if enabled
    if (showTranslation && seg.originalText) {
      text += `\n<font color="#888888">${seg.originalText}</font>`;
    }

    srtContent += `${index}\n${startTime} --> ${endTime}\n${text}\n\n`;
    index++;
  }

  fs.writeFileSync(outputPath, srtContent.trim());

  return {
    path: outputPath,
    count: index - 1,
    format: "srt",
  };
}

/**
 * Format time in SRT format (HH:MM:SS,mmm)
 */
function formatSrtTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

/**
 * Generate FFmpeg filter for vocabulary card overlay
 * 
 * @param {object} overlay - Overlay specification
 * @param {object} videoInfo - Video dimensions { width, height }
 * @returns {string} FFmpeg drawtext filter string
 */
function generateCardFilter(overlay, videoInfo) {
  const { width, height } = videoInfo;
  const style = OVERLAY_STYLES.vocabularyCard;
  
  // Calculate position
  let x, y;
  switch (overlay.position) {
    case "top-left":
      x = style.margin;
      y = style.margin;
      break;
    case "top-right":
      x = `w-tw-${style.margin}`;
      y = style.margin;
      break;
    case "bottom-left":
      x = style.margin;
      y = `h-th-${style.margin}`;
      break;
    case "bottom-right":
    default:
      x = `w-tw-${style.margin}`;
      y = `h-th-${style.margin}`;
      break;
    case "center":
      x = "(w-tw)/2";
      y = "(h-th)/2";
      break;
  }

  // Build display text: Emoji + Word + (Translation)
  const displayText = `${overlay.emoji}  ${overlay.word}\\n(${overlay.translation})`;
  
  // FFmpeg drawtext with fade
  const fadeExpr = `if(lt(t,${overlay.startTime}),0,if(lt(t,${overlay.startTime + overlay.fadeInDuration}),(t-${overlay.startTime})/${overlay.fadeInDuration},if(lt(t,${overlay.endTime - overlay.fadeOutDuration}),1,(${overlay.endTime}-t)/${overlay.fadeOutDuration})))`;

  return `drawtext=text='${escapeText(displayText)}':fontsize=${style.fontSize}:fontcolor=white@{${fadeExpr}}:x=${x}:y=${y}:box=1:boxcolor=black@0.8:boxborderw=${style.padding}:enable='between(t,${overlay.startTime},${overlay.endTime})'`;
}

/**
 * Escape text for FFmpeg drawtext filter
 */
function escapeText(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}

/**
 * Generate complete FFmpeg filter complex for all overlays
 * 
 * @param {array} overlays - Array of overlay specifications
 * @param {object} videoInfo - Video dimensions { width, height }
 * @returns {string} Complete filter_complex string
 */
function generateOverlayFilterComplex(overlays, videoInfo) {
  if (!overlays || overlays.length === 0) {
    return "";
  }

  const filters = overlays.map(overlay => {
    switch (overlay.type) {
      case "card":
        return generateCardFilter(overlay, videoInfo);
      case "highlight":
        return generateHighlightFilter(overlay, videoInfo);
      default:
        return generateCardFilter(overlay, videoInfo);
    }
  });

  // Chain filters together
  return filters.join(",");
}

/**
 * Generate FFmpeg filter for word highlight overlay (centered, large)
 */
function generateHighlightFilter(overlay, videoInfo) {
  const style = OVERLAY_STYLES.wordHighlight;
  
  const displayText = `${overlay.emoji} ${overlay.word}`;
  const fadeExpr = `if(lt(t,${overlay.startTime}),0,if(lt(t,${overlay.startTime + style.fadeInDuration}),(t-${overlay.startTime})/${style.fadeInDuration},if(lt(t,${overlay.endTime - style.fadeOutDuration}),1,(${overlay.endTime}-t)/${style.fadeOutDuration})))`;

  return `drawtext=text='${escapeText(displayText)}':fontsize=${style.fontSize}:fontcolor=black@{${fadeExpr}}:x=(w-tw)/2:y=(h-th)/2:box=1:boxcolor=yellow@0.9:boxborderw=20:enable='between(t,${overlay.startTime},${overlay.endTime})'`;
}

/**
 * Apply vocabulary overlays to a video
 * 
 * @param {string} inputVideo - Input video path
 * @param {array} overlays - Array of overlay specifications
 * @param {string} outputVideo - Output video path
 * @param {object} options - Render options
 * @returns {Promise<object>} Render result
 */
async function renderVideoWithOverlays(inputVideo, overlays, outputVideo, options = {}) {
  const {
    subtitlePath = null,
    burnSubtitles = false,
  } = options;

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎨 RENDERING: Vocabulary Overlays`);
  console.log(`${"═".repeat(60)}`);
  console.log(`   Input: ${path.basename(inputVideo)}`);
  console.log(`   Overlays: ${overlays.length}`);
  console.log(`   Output: ${path.basename(outputVideo)}`);

  // Get video info
  let videoInfo;
  try {
    const probeResult = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${inputVideo}"`,
      { encoding: "utf-8", timeout: 10000 }
    );
    const [width, height] = probeResult.trim().split(",").map(Number);
    videoInfo = { width, height };
  } catch {
    videoInfo = { width: 1920, height: 1080 }; // Default
  }

  console.log(`   Video: ${videoInfo.width}x${videoInfo.height}`);

  // Build filter complex
  const overlayFilter = generateOverlayFilterComplex(overlays, videoInfo);
  
  let filterComplex = overlayFilter;
  
  // Add subtitle filter if needed
  if (burnSubtitles && subtitlePath && fs.existsSync(subtitlePath)) {
    const subFilter = `subtitles='${subtitlePath.replace(/'/g, "'\\''")}'`;
    filterComplex = filterComplex ? `${filterComplex},${subFilter}` : subFilter;
  }

  // Build FFmpeg command
  let cmd;
  if (filterComplex) {
    cmd = `ffmpeg -y -i "${inputVideo}" -vf "${filterComplex}" -c:v libx264 -preset fast -crf 23 -c:a copy "${outputVideo}"`;
  } else {
    cmd = `ffmpeg -y -i "${inputVideo}" -c:v copy -c:a copy "${outputVideo}"`;
  }

  console.log(`   Running FFmpeg...`);

  const startTime = Date.now();

  try {
    execSync(cmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 600000, // 10 min timeout
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const outputSize = fs.statSync(outputVideo).size;

    console.log(`   ✅ Render complete in ${elapsed}s`);
    console.log(`   📦 Output: ${(outputSize / 1024 / 1024).toFixed(1)} MB`);

    return {
      success: true,
      outputPath: outputVideo,
      size: outputSize,
      overlaysApplied: overlays.length,
      processingTime: parseFloat(elapsed),
    };

  } catch (err) {
    console.log(`   ❌ Render failed: ${err.message}`);
    
    // Try simpler render without overlays
    console.log(`   🔄 Retrying without overlays...`);
    try {
      execSync(
        `ffmpeg -y -i "${inputVideo}" -c:v copy -c:a copy "${outputVideo}"`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 60000 }
      );
      return {
        success: true,
        outputPath: outputVideo,
        overlaysApplied: 0,
        fallback: true,
      };
    } catch {
      throw err;
    }
  }
}

/**
 * Generate vocabulary timing data for word-by-word overlay sync
 * 
 * @param {array} segments - Segments with word-level timestamps
 * @param {array} vocabulary - Vocabulary words to highlight
 * @returns {array} Word overlay timing data
 */
function generateWordTimingOverlays(segments, vocabulary) {
  const vocabSet = new Set(vocabulary.map(v => v.word?.toLowerCase()));
  const wordOverlays = [];

  for (const seg of segments) {
    if (!seg.words || seg.words.length === 0) continue;

    for (const word of seg.words) {
      const wordText = (word.word || word.text || "").toLowerCase();
      
      if (vocabSet.has(wordText)) {
        const vocab = vocabulary.find(v => v.word?.toLowerCase() === wordText);
        
        wordOverlays.push({
          type: "highlight",
          word: vocab.word,
          translation: vocab.translation,
          emoji: VOCABULARY_EMOJIS[wordText] || "📝",
          startTime: word.start - 0.1,
          endTime: word.end + 0.5,
          fadeInDuration: 0.1,
          fadeOutDuration: 0.2,
          position: "center",
          difficulty: vocab.difficulty,
        });
      }
    }
  }

  return wordOverlays;
}

/**
 * Create a vocabulary summary card image
 * 
 * @param {array} vocabulary - Vocabulary items
 * @param {string} outputPath - Output image path
 * @param {object} options - Card options
 * @returns {object} Card info
 */
function createVocabularySummaryCard(vocabulary, outputPath, options = {}) {
  const {
    title = "Vocabulario",
    maxWords = 20,
    width = 1920,
    height = 1080,
  } = options;

  // This creates a text file that can be used with FFmpeg to render a summary card
  // For full image generation, you'd use a library like canvas or sharp
  
  const vocabLines = vocabulary.slice(0, maxWords).map(v => {
    const emoji = VOCABULARY_EMOJIS[v.word?.toLowerCase()] || "📝";
    return `${emoji} ${v.word} - ${v.translation}`;
  });

  const summaryText = `${title}\n\n${vocabLines.join("\n")}`;
  
  fs.writeFileSync(outputPath.replace(/\.\w+$/, ".txt"), summaryText);

  return {
    text: summaryText,
    wordCount: vocabulary.slice(0, maxWords).length,
    textPath: outputPath.replace(/\.\w+$/, ".txt"),
  };
}

module.exports = {
  generateVocabularyOverlays,
  generateEnhancedSubtitles,
  generateOverlayFilterComplex,
  generateCardFilter,
  generateHighlightFilter,
  generateWordTimingOverlays,
  renderVideoWithOverlays,
  createVocabularySummaryCard,
  formatSrtTime,
  escapeText,
  VOCABULARY_EMOJIS,
  OVERLAY_STYLES,
};
