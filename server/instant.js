const { getSubtitles } = require("youtube-caption-extractor");

async function fetchSubtitles(videoID, lang = "en") {
  console.log(`⚡ Fetching captions for: ${videoID}\n`);

  try {
    const subtitles = await getSubtitles({ videoID, lang });

    console.log(`✅ Got ${subtitles.length} segments!\n`);

    if (subtitles.length > 0) {
      console.log("First 3 segments:");
      subtitles.slice(0, 3).forEach((s, i) => {
        console.log(`  ${i + 1}. [${s.start}s] "${s.text}"`);
      });

      const fullText = subtitles.map((s) => s.text).join(" ");
      console.log(`\n📝 Preview: "${fullText.substring(0, 200)}..."`);
    }

    return subtitles;
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

const videoID = process.argv[2] || "TUmuavAKLEI";
fetchSubtitles(videoID);
