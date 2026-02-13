/**
 * Caption Parser - handles XML and JSON3 caption formats from YouTube
 */

class CaptionParser {
  /**
   * Parse caption text in either XML or JSON3 format
   * @param {string} captionText - Raw caption text from YouTube
   * @returns {Array} Parsed transcript segments
   */
  static parse(captionText) {
    const trimmed = captionText.trim();

    if (trimmed.startsWith("{")) {
      return Json3Parser.parse(captionText);
    }

    if (trimmed.includes("<transcript>") || trimmed.includes("<text")) {
      return XmlParser.parse(captionText);
    }

    // Unknown format - try both
    const xmlResult = XmlParser.parse(captionText);
    if (xmlResult.length > 0) return xmlResult;

    return Json3Parser.parse(captionText);
  }
}

/**
 * Parser for YouTube's XML caption format
 */
class XmlParser {
  /**
   * Parse XML caption format
   * @param {string} xmlText - XML caption content
   * @returns {Array} Parsed segments
   */
  static parse(xmlText) {
    const segments = [];
    const regex =
      /<text start="([^"]+)" dur="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g;
    let match;
    let index = 0;

    while ((match = regex.exec(xmlText)) !== null) {
      const start = parseFloat(match[1]);
      const duration = parseFloat(match[2]);
      const text = this.decodeText(match[3]);

      if (text) {
        segments.push({
          index: index++,
          text,
          start,
          duration,
          end: start + duration,
        });
      }
    }

    return segments;
  }

  /**
   * Decode HTML entities and clean text
   * @param {string} text - Raw text with HTML entities
   * @returns {string} Clean text
   */
  static decodeText(text) {
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/<[^>]+>/g, "") // Strip nested tags
      .replace(/\n/g, " ")
      .trim();
  }
}

/**
 * Parser for YouTube's JSON3 caption format
 */
class Json3Parser {
  /**
   * Parse JSON3 caption format
   * @param {string} jsonText - JSON3 caption content
   * @returns {Array} Parsed segments
   */
  static parse(jsonText) {
    try {
      const data = JSON.parse(jsonText);
      const events = data.events || [];
      const segments = [];
      let index = 0;

      for (const event of events) {
        if (!event.segs) continue;

        const text = event.segs
          .map((seg) => seg.utf8 || "")
          .join("")
          .trim();

        if (text && event.tStartMs !== undefined) {
          const start = event.tStartMs / 1000;
          const duration = (event.dDurationMs || 0) / 1000;

          segments.push({
            index: index++,
            text,
            start,
            duration,
            end: start + duration,
          });
        }
      }

      return segments;
    } catch (e) {
      console.error("JSON3 parse error:", e.message);
      return [];
    }
  }
}

module.exports = {
  CaptionParser,
  XmlParser,
  Json3Parser,
};
