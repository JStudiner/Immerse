/**
 * TikTok Hook Generator
 * 
 * Generates engaging hooks for the first 3 seconds of TikTok videos
 * Uses Gemini to create attention-grabbing openings
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Generate a hook for TikTok video
 */
async function generateHook(videoContext, options = {}) {
  const {
    language = "spanish",
    level = "B1",
    niche = "general",
    targetLength = 25, // Characters (about 3 seconds at 8 c/s)
  } = options;

  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

  const prompt = `You are a TikTok content expert. Generate a HOOK for the first 3 seconds of a language learning video.

VIDEO CONTEXT:
${videoContext}

REQUIREMENTS:
- Target language: ${language.toUpperCase()}
- CEFR level: ${level}
- Maximum ${targetLength} characters
- Must hook viewer in first 3 seconds
- Use patterns like:
  * "POV: You finally understand..."
  * "This [word/phrase] will change everything"
  * "Wait until you hear this..."
  * "You've been saying this wrong..."
  * "Secret to understanding [topic]"
- Make it curiosity-driven or emotion-driven
- Match the ${niche} niche

OUTPUT as JSON:
{
  "hook": "The hook text in ${language}",
  "translation": "English translation",
  "emotion": "curiosity|surprise|humor|shock",
  "pattern": "POV|secret|wait|wrong|etc"
}`;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    // Extract JSON
    const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                      responseText.match(/\{[\s\S]*?\}/);
    
    if (jsonMatch) {
      const hookData = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      return {
        success: true,
        ...hookData,
      };
    }
    
    throw new Error("Failed to parse hook JSON");
  } catch (error) {
    console.error(`❌ Hook generation failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Generate TikTok metadata (captions, hashtags, text overlays)
 */
async function generateTikTokMetadata(videoContext, options = {}) {
  const {
    language = "spanish",
    level = "B1",
    niche = "general",
    duration = 60,
  } = options;

  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

  const prompt = `You are a TikTok content strategist. Generate complete metadata for a language learning video.

VIDEO CONTEXT:
${videoContext}

VIDEO DETAILS:
- Language: ${language}
- Level: ${level}
- Niche: ${niche}
- Duration: ${duration}s

Generate:
1. CAPTION (150-200 chars): Engaging caption for the post
2. HASHTAGS (8-12): Trending + niche-specific hashtags
3. TOP TEXT: Text to display above video (for hook)
4. BOTTOM TEXT: Text to display below video (CTA or tagline)

OUTPUT as JSON:
{
  "caption": "TikTok caption text...",
  "hashtags": ["#spanish", "#languagelearning", ...],
  "topText": "POV: You finally understand...",
  "bottomText": "Follow for more Spanish secrets 🔥",
  "hook": "First 3 seconds hook in ${language}",
  "cta": "Call to action"
}`;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    
    // Extract JSON
    const jsonMatch = responseText.match(/```json\n([\s\S]*?)\n```/) || 
                      responseText.match(/\{[\s\S]*?\}/);
    
    if (jsonMatch) {
      const metadata = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      return {
        success: true,
        ...metadata,
      };
    }
    
    throw new Error("Failed to parse metadata JSON");
  } catch (error) {
    console.error(`❌ Metadata generation failed: ${error.message}`);
    
    // Return fallback metadata
    return {
      success: false,
      caption: `Learning ${language} made easy! #${language} #languagelearning`,
      hashtags: ["#spanish", "#languagelearning", "#learnspanish", "#polyglot"],
      topText: "POV: You understand Spanish now",
      bottomText: "Follow for more! 🔥",
      hook: language === "spanish" ? "¿Sabías esto?" : "Did you know this?",
      cta: "Follow for daily lessons",
      error: error.message,
    };
  }
}

/**
 * Add hook to the beginning of translated segments
 */
function addHookToSegments(segments, hook, hookDuration = 3) {
  // Insert hook as first segment
  const hookSegment = {
    index: -1,
    start: 0,
    end: hookDuration,
    duration: hookDuration,
    speaker: segments[0]?.speaker || "SPEAKER_00",
    originalText: "[HOOK]",
    translatedText: hook,
    isHook: true,
  };

  // Shift all other segments forward
  const shiftedSegments = segments.map(seg => ({
    ...seg,
    start: seg.start + hookDuration,
    end: seg.end + hookDuration,
    index: seg.index + 1,
  }));

  return [hookSegment, ...shiftedSegments];
}

/**
 * Extract video context for hook generation
 */
function extractVideoContext(segments, options = {}) {
  const { maxChars = 500 } = options;
  
  // Get first few segments to understand video content
  const firstSegments = segments.slice(0, Math.min(5, segments.length));
  const context = firstSegments
    .map(seg => seg.text || seg.originalText)
    .join(" ")
    .substring(0, maxChars);
  
  return context;
}

module.exports = {
  generateHook,
  generateTikTokMetadata,
  addHookToSegments,
  extractVideoContext,
};
