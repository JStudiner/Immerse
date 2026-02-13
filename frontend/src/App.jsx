import { useState, useRef, useEffect } from "react";
import {
  Youtube,
  FileText,
  Mic,
  MicOff,
  Link,
  Play,
  Pause,
  Download,
  Film,
  Volume2,
  VolumeX,
  Check,
  Loader,
  AlertCircle,
  Upload,
  X,
  RefreshCw,
  Settings,
  Sparkles,
  Globe,
  User,
  Users,
  BookOpen,
  Headphones,
  Code,
  Zap,
} from "lucide-react";
import "./App.css";

const API_URL = "/api";

// ============================================
// TIER CONFIGURATION (User Mode)
// ============================================

const TIER_INFO = {
  learner: {
    id: "learner",
    name: "Learner",
    icon: "📚",
    tagline: "Quick & affordable",
    description:
      "Standard voices, fast processing. Understand the gist quickly.",
    levels: ["A1", "A2"],
    defaultLevel: "A2",
    features: [
      "Fast processing (~2 min)",
      "Standard TTS voices",
      "A1-A2 levels",
      "Synced mode",
    ],
    cost: "~$0.05 / 5 min",
    color: "#10b981",
    gradient: "linear-gradient(135deg, #10b981, #059669)",
  },
  immerser: {
    id: "immerser",
    name: "Immerser",
    icon: "🌊",
    tagline: "Premium quality",
    description: "High-quality ElevenLabs voices with natural-sounding output.",
    levels: ["A1", "A2", "B1", "B2"],
    defaultLevel: "B1",
    features: [
      "Premium ElevenLabs voices",
      "Narrator modes",
      "All beginner/intermediate levels",
      "Custom voice selection",
    ],
    cost: "~$0.50 / 5 min",
    color: "#3b82f6",
    gradient: "linear-gradient(135deg, #3b82f6, #2563eb)",
  },
  pro: {
    id: "pro",
    name: "Pro",
    icon: "🚀",
    tagline: "Voice cloning + TikTok",
    description:
      "Clone the speaker's voice with XTTS. Full control over everything.",
    levels: ["A1", "A2", "B1", "B2", "C1"],
    defaultLevel: "B1",
    features: [
      "XTTS voice cloning",
      "TikTok format export",
      "AI lip-sync",
      "All levels (A1-C1)",
      "Voice extraction",
    ],
    cost: "~$0.40 / 5 min",
    color: "#f59e0b",
    gradient: "linear-gradient(135deg, #f59e0b, #d97706)",
  },
};

// ============================================
// CONFIGURATION - All Pipeline Options
// ============================================

const LEVELS = [
  {
    value: "A1",
    label: "A1 - Superbeginner",
    desc: "500 words, present tense",
  },
  { value: "A2", label: "A2 - Beginner", desc: "1500 words, simple past" },
  {
    value: "B1",
    label: "B1 - Intermediate",
    desc: "3000 words, all indicative",
  },
  { value: "B2", label: "B2 - Upper Intermediate", desc: "Full grammar" },
  { value: "C1", label: "C1 - Advanced", desc: "Native-like complexity" },
];

const VOICES = [
  { value: "male", label: "Male", gender: "male" },
  { value: "female", label: "Female", gender: "female" },
  { value: "neutral", label: "Neutral", gender: "neutral" },
  { value: "auto", label: "Auto-detect", gender: "auto" },
];

// Specific voice options per TTS provider (shown in dev mode)
const SPECIFIC_VOICES = {
  default: {
    // Lemonfox
    label: "Lemonfox Voice",
    voices: [
      { value: "", label: "Auto (from gender)" },
      { value: "noel", label: "Noel (Male, Spanish-native)" },
      { value: "alex", label: "Alex (Neutral, Spanish-native)" },
      { value: "dora", label: "Dora (Female, Spanish-native)" },
      { value: "adam", label: "Adam (Male, English)" },
      { value: "onyx", label: "Onyx (Male, English)" },
      { value: "echo", label: "Echo (Male, English)" },
      { value: "eric", label: "Eric (Male, English)" },
      { value: "nova", label: "Nova (Female, English)" },
      { value: "alloy", label: "Alloy (Female, English)" },
      { value: "jessica", label: "Jessica (Female, English)" },
      { value: "bella", label: "Bella (Female, English)" },
    ],
  },
  premium: {
    // ElevenLabs
    label: "ElevenLabs Voice",
    voices: [
      { value: "", label: "Auto (from gender)" },
      { value: "adam", label: "Adam (Male, deep)" },
      { value: "matt", label: "Matt (Male, custom)" },
      { value: "josh", label: "Josh (Male, warm)" },
      { value: "daniel", label: "Daniel (Male, clear)" },
      { value: "matthew", label: "Matthew (Male, friendly)" },
      { value: "liam", label: "Liam (Male, young)" },
      { value: "veronica", label: "Veronica (Female, Spanish)" },
      { value: "rachel", label: "Rachel (Female, warm)" },
      { value: "sarah", label: "Sarah (Female, clear)" },
      { value: "matilda", label: "Matilda (Female, friendly)" },
      { value: "charlotte", label: "Charlotte (Female, elegant)" },
      { value: "grace", label: "Grace (Female, soft)" },
      { value: "drew", label: "Drew (Male, authoritative)" },
      { value: "paul", label: "Paul (Male, narrator)" },
      { value: "charlie", label: "Charlie (Male, casual)" },
      { value: "emily", label: "Emily (Female, expressive)" },
      { value: "nicole", label: "Nicole (Female, professional)" },
      { value: "giovanni", label: "Giovanni (Male, Italian)" },
    ],
  },
};

const MODES = [
  {
    value: "synced",
    label: "Synced",
    desc: "Direct translation, original timing",
    icon: "🎬",
  },
  {
    value: "narrator",
    label: "Narrator",
    desc: "Time-filling, slower speech",
    icon: "🎙️",
  },
  {
    value: "narrator-only",
    label: "Narrator Only",
    desc: "Only dub main speaker",
    icon: "🎤",
  },
  {
    value: "learner",
    label: "Learner",
    desc: "Slower TTS, audio-only",
    icon: "📚",
  },
  {
    value: "extended",
    label: "Extended",
    desc: "Video stretched for full translation",
    icon: "⏱️",
  },
  {
    value: "brainrot",
    label: "Brainrot",
    desc: "TikTok-style narration",
    icon: "🧠",
  },
];

const LANGUAGES = [
  { value: "spanish", label: "Spanish 🇪🇸" },
  { value: "indonesian", label: "Indonesian 🇮🇩" },
];

// TTS Provider options (mutually exclusive)
const TTS_PROVIDERS = [
  {
    value: "default",
    label: "Standard",
    desc: "Lemonfox preset voices (fast)",
    icon: "🎤",
  },
  {
    value: "premium",
    label: "Premium",
    desc: "ElevenLabs (higher quality)",
    icon: "✨",
  },
  {
    value: "clone",
    label: "Voice Clone",
    desc: "Clone original speaker (XTTS)",
    icon: "🎭",
  },
];

// Narrator Mode options (when clone or narrator mode is selected)
const NARRATOR_MODES = [
  {
    value: "clone_speaker",
    label: "Clone Speaker",
    desc: "Clone original speaker's voice (1st person)",
    icon: "🎭",
    hint: "Best for: vlogs, tutorials, podcasts",
  },
  {
    value: "third_party",
    label: "Third Party",
    desc: "External narrator describes content (3rd person)",
    icon: "🎙️",
    hint: "Best for: movie recaps, news, documentaries",
  },
  {
    value: "custom_narrator",
    label: "Custom Voice",
    desc: "Use your own voice sample or YouTube voice",
    icon: "🎨",
    hint: "Upload audio or paste YouTube URL",
  },
  {
    value: "storyteller",
    label: "Storyteller",
    desc: "Hybrid: action in 3rd person, dialogue in 1st",
    icon: "📖",
    hint: "Best for: fiction, stories, dramas",
  },
];

// Voice source options for custom narrator
const VOICE_SOURCES = [
  { value: "video", label: "From Video", desc: "Extract from input video" },
  { value: "file", label: "Upload File", desc: "Upload your own voice sample" },
  {
    value: "youtube",
    label: "YouTube URL",
    desc: "Extract voice from any YouTube video",
  },
];

// Additional enhancement flags (can combine)
const ENHANCEMENT_FLAGS = [
  {
    value: "lipsync",
    label: "Lip Sync",
    desc: "AI lip-sync ($6/5min)",
    icon: "👄",
  },
  {
    value: "quality",
    label: "High Quality",
    desc: "Better audio separation",
    icon: "🎵",
  },
];

// TikTok format options
const TIKTOK_STYLES = [
  {
    value: "none",
    label: "No TikTok Format",
    desc: "Keep original aspect ratio",
  },
  {
    value: "square",
    label: "Square (1:1)",
    desc: "Most popular for movie clips",
    icon: "⬜",
  },
  {
    value: "letterbox",
    label: "Letterbox (16:9)",
    desc: "Cinematic with padding",
    icon: "📺",
  },
  {
    value: "cinematic",
    label: "Cinematic (2.35:1)",
    desc: "Ultra-wide movie feel",
    icon: "🎬",
  },
  {
    value: "large",
    label: "Large",
    desc: "Video takes most of screen",
    icon: "📱",
  },
];

const TIKTOK_BACKGROUNDS = [
  { value: "blur", label: "Blurred", desc: "Video blurred as background" },
  { value: "black", label: "Black", desc: "Solid black background" },
  { value: "gradient", label: "Gradient", desc: "Dark gradient" },
];

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

// ============================================
// MAIN APP COMPONENT
// ============================================

function App() {
  // App mode: "user" (simplified) or "dev" (full control)
  const [appMode, setAppMode] = useState(() => {
    return localStorage.getItem("immerse-app-mode") || "user";
  });

  // User mode tier selection
  const [selectedTier, setSelectedTier] = useState("immerser");

  // Helper function to get persisted state
  const getPersistedState = (key, defaultValue) => {
    try {
      const item = localStorage.getItem(`immerse-${key}`);
      return item ? JSON.parse(item) : defaultValue;
    } catch {
      return defaultValue;
    }
  };

  // Input state
  const [inputType, setInputType] = useState(() =>
    getPersistedState("inputType", "url"),
  );
  const [url, setUrl] = useState(() => getPersistedState("url", ""));
  const [uploadedFile, setUploadedFile] = useState(null);

  // Voice extraction state
  const [extractionFile, setExtractionFile] = useState(null);
  const [extractionUrl, setExtractionUrl] = useState("");
  const [extractionSource, setExtractionSource] = useState("file"); // 'file' or 'youtube'
  const [voiceSamples, setVoiceSamples] = useState([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [selectedSample, setSelectedSample] = useState(null);
  const [audioRefs, setAudioRefs] = useState({});
  const [extractionSpeakers, setExtractionSpeakers] = useState([]);

  // Pipeline options
  const [level, setLevel] = useState(() => getPersistedState("level", "B1"));
  const [voice, setVoice] = useState(() =>
    getPersistedState("voice", "neutral"),
  );
  const [mode, setMode] = useState(() => getPersistedState("mode", "synced"));
  const [language, setLanguage] = useState(() =>
    getPersistedState("language", "spanish"),
  );
  const [ttsProvider, setTtsProvider] = useState(() =>
    getPersistedState("ttsProvider", "default"),
  );
  const [specificVoice, setSpecificVoice] = useState(() =>
    getPersistedState("specificVoice", ""),
  );
  const [flags, setFlags] = useState(() => getPersistedState("flags", []));
  const [showAdvanced, setShowAdvanced] = useState(() =>
    getPersistedState("showAdvanced", false),
  );

  // Narrator mode options (for clone/narrator modes)
  const [narratorMode, setNarratorMode] = useState(() =>
    getPersistedState("narratorMode", "clone_speaker"),
  );
  const [voiceSource, setVoiceSource] = useState(() =>
    getPersistedState("voiceSource", "video"),
  );
  const [customVoiceFile, setCustomVoiceFile] = useState(null);
  const [selectedVoiceSampleUrl, setSelectedVoiceSampleUrl] = useState(null); // URL from extracted samples
  const [customVoiceUrl, setCustomVoiceUrl] = useState(() =>
    getPersistedState("customVoiceUrl", ""),
  );
  const [youtubeVoiceManual, setYoutubeVoiceManual] = useState(() =>
    getPersistedState("youtubeVoiceManual", false),
  );
  const [voiceStartTime, setVoiceStartTime] = useState(() =>
    getPersistedState("voiceStartTime", "30"),
  );
  const [voiceDuration, setVoiceDuration] = useState(() =>
    getPersistedState("voiceDuration", "15"),
  );

  // Advanced options
  const [startTime, setStartTime] = useState(() =>
    getPersistedState("startTime", ""),
  );
  const [duration, setDuration] = useState(() =>
    getPersistedState("duration", ""),
  );
  const [speakers, setSpeakers] = useState(() =>
    getPersistedState("speakers", ""),
  );
  const [assignVoices, setAssignVoices] = useState(() =>
    getPersistedState("assignVoices", ""),
  );

  // TikTok format options
  const [tiktokStyle, setTiktokStyle] = useState(() =>
    getPersistedState("tiktokStyle", "none"),
  );
  const [tiktokBackground, setTiktokBackground] = useState(() =>
    getPersistedState("tiktokBackground", "blur"),
  );
  const [tiktokTopText, setTiktokTopText] = useState(() =>
    getPersistedState("tiktokTopText", ""),
  );
  const [tiktokBottomText, setTiktokBottomText] = useState(() =>
    getPersistedState("tiktokBottomText", ""),
  );
  const [addHook, setAddHook] = useState(() =>
    getPersistedState("addHook", false),
  );
  const [generateMetadata, setGenerateMetadata] = useState(() =>
    getPersistedState("generateMetadata", false),
  );

  // Processing state - persist these for resuming jobs
  const [isProcessing, setIsProcessing] = useState(() =>
    getPersistedState("isProcessing", false),
  );
  const [jobId, setJobId] = useState(() => getPersistedState("jobId", null));
  const [progress, setProgress] = useState(() =>
    getPersistedState("progress", 0),
  );
  const [currentStep, setCurrentStep] = useState(() =>
    getPersistedState("currentStep", ""),
  );
  const [error, setError] = useState(null);
  const [result, setResult] = useState(() => getPersistedState("result", null));

  // Player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [voiceVolume, setVoiceVolume] = useState(0.85);
  const [bgVolume, setBgVolume] = useState(0.3);
  const prevVoiceVolume = useRef(0.85);
  const prevBgVolume = useRef(0.3);

  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const voiceAudioRef = useRef(null);
  const bgAudioRef = useRef(null);
  const fileInputRef = useRef(null);
  const voiceFileInputRef = useRef(null);
  const pollIntervalRef = useRef(null);

  // Check if we have separate audio tracks for mixing
  const hasSeparateTracks = !!(result?.voiceOnlyUrl && result?.backgroundUrl);

  // Show narrator options when using clone TTS or narrator modes
  const showNarratorOptions =
    ttsProvider === "clone" || mode.includes("narrator");

  // Persist state to localStorage
  useEffect(() => {
    localStorage.setItem("immerse-app-mode", appMode);
  }, [appMode]);
  useEffect(() => {
    localStorage.setItem("immerse-inputType", JSON.stringify(inputType));
  }, [inputType]);
  useEffect(() => {
    localStorage.setItem("immerse-url", JSON.stringify(url));
  }, [url]);
  useEffect(() => {
    localStorage.setItem("immerse-level", JSON.stringify(level));
  }, [level]);
  useEffect(() => {
    localStorage.setItem("immerse-voice", JSON.stringify(voice));
  }, [voice]);
  useEffect(() => {
    localStorage.setItem("immerse-mode", JSON.stringify(mode));
  }, [mode]);
  useEffect(() => {
    localStorage.setItem("immerse-language", JSON.stringify(language));
  }, [language]);
  useEffect(() => {
    localStorage.setItem("immerse-ttsProvider", JSON.stringify(ttsProvider));
  }, [ttsProvider]);
  useEffect(() => {
    localStorage.setItem(
      "immerse-specificVoice",
      JSON.stringify(specificVoice),
    );
  }, [specificVoice]);
  useEffect(() => {
    localStorage.setItem("immerse-flags", JSON.stringify(flags));
  }, [flags]);
  useEffect(() => {
    localStorage.setItem("immerse-showAdvanced", JSON.stringify(showAdvanced));
  }, [showAdvanced]);
  useEffect(() => {
    localStorage.setItem("immerse-narratorMode", JSON.stringify(narratorMode));
  }, [narratorMode]);
  useEffect(() => {
    localStorage.setItem("immerse-voiceSource", JSON.stringify(voiceSource));
  }, [voiceSource]);
  useEffect(() => {
    localStorage.setItem(
      "immerse-customVoiceUrl",
      JSON.stringify(customVoiceUrl),
    );
  }, [customVoiceUrl]);
  useEffect(() => {
    localStorage.setItem(
      "immerse-youtubeVoiceManual",
      JSON.stringify(youtubeVoiceManual),
    );
  }, [youtubeVoiceManual]);
  useEffect(() => {
    localStorage.setItem(
      "immerse-voiceStartTime",
      JSON.stringify(voiceStartTime),
    );
  }, [voiceStartTime]);
  useEffect(() => {
    localStorage.setItem(
      "immerse-voiceDuration",
      JSON.stringify(voiceDuration),
    );
  }, [voiceDuration]);
  useEffect(() => {
    localStorage.setItem("immerse-startTime", JSON.stringify(startTime));
  }, [startTime]);
  useEffect(() => {
    localStorage.setItem("immerse-duration", JSON.stringify(duration));
  }, [duration]);
  useEffect(() => {
    localStorage.setItem("immerse-speakers", JSON.stringify(speakers));
  }, [speakers]);
  useEffect(() => {
    localStorage.setItem("immerse-assignVoices", JSON.stringify(assignVoices));
  }, [assignVoices]);
  useEffect(() => {
    localStorage.setItem("immerse-tiktokStyle", JSON.stringify(tiktokStyle));
  }, [tiktokStyle]);
  useEffect(() => {
    localStorage.setItem(
      "immerse-tiktokBackground",
      JSON.stringify(tiktokBackground),
    );
  }, [tiktokBackground]);
  useEffect(() => {
    localStorage.setItem(
      "immerse-tiktokTopText",
      JSON.stringify(tiktokTopText),
    );
  }, [tiktokTopText]);
  useEffect(() => {
    localStorage.setItem(
      "immerse-tiktokBottomText",
      JSON.stringify(tiktokBottomText),
    );
  }, [tiktokBottomText]);
  useEffect(() => {
    localStorage.setItem("immerse-addHook", JSON.stringify(addHook));
  }, [addHook]);
  useEffect(() => {
    localStorage.setItem(
      "immerse-generateMetadata",
      JSON.stringify(generateMetadata),
    );
  }, [generateMetadata]);
  useEffect(() => {
    localStorage.setItem("immerse-isProcessing", JSON.stringify(isProcessing));
  }, [isProcessing]);
  useEffect(() => {
    localStorage.setItem("immerse-jobId", JSON.stringify(jobId));
  }, [jobId]);
  useEffect(() => {
    localStorage.setItem("immerse-progress", JSON.stringify(progress));
  }, [progress]);
  useEffect(() => {
    localStorage.setItem("immerse-currentStep", JSON.stringify(currentStep));
  }, [currentStep]);
  useEffect(() => {
    localStorage.setItem("immerse-result", JSON.stringify(result));
  }, [result]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Resume polling if there was a job in progress
  useEffect(() => {
    if (jobId && isProcessing && !pollIntervalRef.current) {
      console.log(`Resuming polling for job ${jobId}`);

      // Start polling immediately
      pollIntervalRef.current = setInterval(async () => {
        try {
          const statusResponse = await fetch(`${API_URL}/v2/status/${jobId}`);
          if (!statusResponse.ok) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
            throw new Error("Failed to get job status");
          }

          const statusData = await statusResponse.json();
          setProgress(statusData.progress || 0);
          setCurrentStep(statusData.currentStep || "Processing...");

          if (statusData.status === "completed") {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
            setProgress(100);
            setResult(statusData.result);
            setIsProcessing(false);
          } else if (statusData.status === "failed") {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
            setError(statusData.error || "Processing failed");
            setIsProcessing(false);
          }
        } catch (pollError) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          setError(pollError.message);
          setIsProcessing(false);
        }
      }, 2000);
    }
  }, []); // Only run once on mount

  // Sync playback speed across all media elements
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackSpeed;
    if (audioRef.current) audioRef.current.playbackRate = playbackSpeed;
    if (voiceAudioRef.current)
      voiceAudioRef.current.playbackRate = playbackSpeed;
    if (bgAudioRef.current) bgAudioRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  // Sync separate audio volumes
  useEffect(() => {
    if (voiceAudioRef.current)
      voiceAudioRef.current.volume = isMuted ? 0 : voiceVolume;
  }, [voiceVolume, isMuted]);

  useEffect(() => {
    if (bgAudioRef.current) bgAudioRef.current.volume = isMuted ? 0 : bgVolume;
  }, [bgVolume, isMuted]);

  // Toggle flag
  const toggleFlag = (flag) => {
    setFlags((prev) =>
      prev.includes(flag) ? prev.filter((f) => f !== flag) : [...prev, flag],
    );
  };

  // Handle file selection
  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file);
      setInputType("file");
    }
  };

  // Handle custom voice file selection
  const handleVoiceFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const ext = file.name.split(".").pop()?.toLowerCase();
      const allowed = ["mp3", "wav", "m4a", "aac", "ogg", "flac"];
      if (allowed.includes(ext)) {
        setCustomVoiceFile(file);
        setVoiceSource("file");
      } else {
        setError(
          `Voice file type .${ext} not supported. Use: ${allowed.join(", ")}`,
        );
      }
    }
  };

  // Handle voice extraction - AUTO MODE
  const handleExtractVoice = async () => {
    if (extractionSource === "file" && !extractionFile) {
      setError("Please select a file to extract voice from");
      return;
    }
    if (extractionSource === "youtube" && !extractionUrl) {
      setError("Please enter a YouTube URL");
      return;
    }

    setIsExtracting(true);
    setError(null);
    setVoiceSamples([]);
    setExtractionSpeakers([]);

    try {
      const formData = new FormData();

      if (extractionSource === "file") {
        formData.append("file", extractionFile);
      } else {
        formData.append("url", extractionUrl);
      }

      formData.append("mode", "auto"); // Use automatic extraction
      formData.append("samplesPerSpeaker", "3"); // Get top 3 per speaker

      const response = await fetch(`${API_URL}/v2/extract-voice`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Voice extraction failed");
      }

      const data = await response.json();
      setVoiceSamples(data.samples);
      setExtractionSpeakers(data.speakers || []);
      setSelectedSample(data.bestSample.id);

      console.log(
        `✅ Auto-extracted ${data.samples.length} samples from ${data.speakers?.length || 1} speaker(s)`,
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setIsExtracting(false);
    }
  };

  // Play/pause audio sample
  const toggleSampleAudio = (sampleId) => {
    const audio = audioRefs[sampleId];
    if (!audio) {
      console.log(`Audio ref not found for ${sampleId}`);
      return;
    }

    if (audio.paused) {
      // Pause all other audio first
      Object.values(audioRefs).forEach((a) => {
        if (a && !a.paused) a.pause();
      });
      audio.play().catch((err) => {
        console.error("Error playing audio:", err);
        setError("Could not play audio sample. URL: " + audio.src);
      });
    } else {
      audio.pause();
    }
  };

  // Handle file drop
  const handleFileDrop = (e) => {
    e.preventDefault();
    e.currentTarget.classList.remove("dragover");
    const file = e.dataTransfer.files?.[0];
    if (file) {
      const ext = file.name.split(".").pop()?.toLowerCase();
      const allowed = ["mp4", "mkv", "webm", "mov", "avi", "mp3", "wav", "m4a"];
      if (allowed.includes(ext)) {
        setUploadedFile(file);
        setInputType("file");
      } else {
        setError(`File type .${ext} not supported. Use: ${allowed.join(", ")}`);
      }
    }
  };

  // Submit handler
  const handleSubmit = async () => {
    setError(null);
    setIsProcessing(true);
    setProgress(0);
    setCurrentStep("Starting...");
    setJobId(null);

    try {
      let response;

      // Build flags array with TTS provider
      const allFlags = [...flags];
      if (ttsProvider === "premium") allFlags.push("premium");
      if (ttsProvider === "clone") allFlags.push("clone");

      // Build narrator options
      const narratorOptions = showNarratorOptions
        ? {
            narratorMode,
            voiceSource,
            voiceStartTime: voiceStartTime || "30",
            voiceDuration: voiceDuration || "15",
            customVoiceUrl: voiceSource === "youtube" ? customVoiceUrl : null,
          }
        : null;

      // Build TikTok options
      const tiktokOptions =
        tiktokStyle !== "none"
          ? {
              style: tiktokStyle,
              background: tiktokBackground,
              topText: tiktokTopText || null,
              bottomText: tiktokBottomText || null,
              addHook,
              generateMetadata,
            }
          : null;

      // Use specific voice name if selected, otherwise use gender
      const effectiveVoice = specificVoice || voice;

      if (inputType === "file" && uploadedFile) {
        // File upload
        const formData = new FormData();
        formData.append("file", uploadedFile);
        formData.append("level", level);
        formData.append("voice", effectiveVoice);
        formData.append("mode", mode);
        formData.append("language", language);
        formData.append("flags", JSON.stringify(allFlags));
        if (narratorOptions)
          formData.append("narratorOptions", JSON.stringify(narratorOptions));
        if (tiktokOptions)
          formData.append("tiktokOptions", JSON.stringify(tiktokOptions));
        if (startTime) formData.append("startTime", startTime);
        if (duration) formData.append("duration", duration);
        if (speakers) formData.append("speakers", speakers);
        if (assignVoices) formData.append("assignVoices", assignVoices);

        // Add custom voice file if selected
        if (voiceSource === "file" && customVoiceFile) {
          formData.append("voiceFile", customVoiceFile);
        }

        response = await fetch(`${API_URL}/v2/process-file`, {
          method: "POST",
          body: formData,
        });
      } else {
        // URL processing
        if (!url) {
          throw new Error("Please enter a URL");
        }

        response = await fetch(`${API_URL}/v2/process`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            level,
            voice: effectiveVoice,
            mode,
            language,
            flags: allFlags,
            narratorOptions,
            tiktokOptions,
            startTime: startTime || null,
            duration: duration || null,
            speakers: speakers || null,
            assignVoices: assignVoices || null,
            voiceSampleUrl: selectedVoiceSampleUrl || null, // Pass extracted voice sample URL
          }),
        });
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Processing failed");
      }

      const data = await response.json();
      setJobId(data.jobId);

      // If server returned a cached result, fetch it immediately
      if (data.cached || data.status === "completed") {
        const statusResponse = await fetch(
          `${API_URL}/v2/status/${data.jobId}`,
        );
        const statusData = await statusResponse.json();
        setProgress(100);
        setCurrentStep("Done! (cached)");
        setResult(statusData.result);
        setIsProcessing(false);
        return;
      }

      // Start polling for status
      pollIntervalRef.current = setInterval(async () => {
        try {
          const statusResponse = await fetch(
            `${API_URL}/v2/status/${data.jobId}`,
          );
          if (!statusResponse.ok) {
            clearInterval(pollIntervalRef.current);
            throw new Error("Failed to get job status");
          }

          const statusData = await statusResponse.json();
          setProgress(statusData.progress || 0);
          setCurrentStep(statusData.currentStep || "Processing...");

          if (statusData.status === "completed") {
            clearInterval(pollIntervalRef.current);
            setProgress(100);
            setResult(statusData.result);
            setIsProcessing(false);
          } else if (statusData.status === "failed") {
            clearInterval(pollIntervalRef.current);
            throw new Error(statusData.error || "Processing failed");
          }
        } catch (pollError) {
          clearInterval(pollIntervalRef.current);
          setError(pollError.message);
          setIsProcessing(false);
        }
      }, 2000);
    } catch (err) {
      setError(err.message);
      setIsProcessing(false);
    }
  };

  // Reset handler
  const handleReset = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    if (voiceAudioRef.current) {
      voiceAudioRef.current.pause();
      voiceAudioRef.current.src = "";
    }
    if (bgAudioRef.current) {
      bgAudioRef.current.pause();
      bgAudioRef.current.src = "";
    }

    // Clear processing state
    setResult(null);
    setJobId(null);
    setProgress(0);
    setCurrentStep("");
    setError(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setVideoDuration(0);
    setVoiceVolume(0.85);
    setBgVolume(0.3);
    setIsProcessing(false);

    // Clear persisted processing state from localStorage
    localStorage.removeItem("immerse-result");
    localStorage.removeItem("immerse-jobId");
    localStorage.removeItem("immerse-progress");
    localStorage.removeItem("immerse-currentStep");
    localStorage.removeItem("immerse-isProcessing");
  };

  // Player controls
  const togglePlay = () => {
    const media = videoRef.current || audioRef.current || voiceAudioRef.current;
    if (media) {
      if (isPlaying) {
        media.pause();
        if (voiceAudioRef.current && voiceAudioRef.current !== media)
          voiceAudioRef.current.pause();
        if (bgAudioRef.current) bgAudioRef.current.pause();
      } else {
        media.play();
        if (voiceAudioRef.current && voiceAudioRef.current !== media)
          voiceAudioRef.current.play();
        if (bgAudioRef.current) bgAudioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleSeek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newTime = percent * videoDuration;
    const media = videoRef.current || audioRef.current || voiceAudioRef.current;
    if (media) {
      media.currentTime = newTime;
      setCurrentTime(newTime);
    }
    if (voiceAudioRef.current && voiceAudioRef.current !== media)
      voiceAudioRef.current.currentTime = newTime;
    if (bgAudioRef.current) bgAudioRef.current.currentTime = newTime;
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // User Mode submit handler - simplified version
  const handleUserSubmit = async () => {
    setError(null);
    setIsProcessing(true);
    setProgress(0);
    setCurrentStep("Starting...");
    setJobId(null);

    try {
      const tier = TIER_INFO[selectedTier];
      const tierFlags = [];
      if (selectedTier === "immerser") tierFlags.push("premium");
      if (selectedTier === "pro") tierFlags.push("clone");

      let response;

      if (inputType === "file" && uploadedFile) {
        const formData = new FormData();
        formData.append("file", uploadedFile);
        formData.append("level", level || tier.defaultLevel);
        formData.append("voice", "auto");
        formData.append("mode", "synced");
        formData.append("language", language);
        formData.append("flags", JSON.stringify(tierFlags));
        formData.append("tier", selectedTier);

        response = await fetch(`${API_URL}/v2/process-file`, {
          method: "POST",
          body: formData,
        });
      } else {
        if (!url) {
          throw new Error("Please enter a URL");
        }
        response = await fetch(`${API_URL}/v2/process`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            level: level || tier.defaultLevel,
            voice: "auto",
            mode: "synced",
            language,
            flags: tierFlags,
            tier: selectedTier,
          }),
        });
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Processing failed");
      }

      const data = await response.json();
      setJobId(data.jobId);

      // If server returned a cached result, fetch it immediately
      if (data.cached || data.status === "completed") {
        const statusResponse = await fetch(
          `${API_URL}/v2/status/${data.jobId}`,
        );
        const statusData = await statusResponse.json();
        setProgress(100);
        setCurrentStep("Done! (cached)");
        setResult(statusData.result);
        setIsProcessing(false);
        return;
      }

      // Poll for status (reuse existing polling logic)
      pollIntervalRef.current = setInterval(async () => {
        try {
          const statusResponse = await fetch(
            `${API_URL}/v2/status/${data.jobId}`,
          );
          if (!statusResponse.ok) {
            clearInterval(pollIntervalRef.current);
            throw new Error("Failed to get job status");
          }
          const statusData = await statusResponse.json();
          setProgress(statusData.progress || 0);
          setCurrentStep(statusData.currentStep || "Processing...");

          if (statusData.status === "completed") {
            clearInterval(pollIntervalRef.current);
            setProgress(100);
            setResult(statusData.result);
            setIsProcessing(false);
          } else if (statusData.status === "failed") {
            clearInterval(pollIntervalRef.current);
            throw new Error(statusData.error || "Processing failed");
          }
        } catch (pollError) {
          clearInterval(pollIntervalRef.current);
          setError(pollError.message);
          setIsProcessing(false);
        }
      }, 2000);
    } catch (err) {
      setError(err.message);
      setIsProcessing(false);
    }
  };

  // Processing steps for display
  const STEPS = [
    { id: "ingest", label: "Downloading video..." },
    { id: "split", label: "Separating audio (Demucs)..." },
    { id: "transcribe", label: "Transcribing speech..." },
    { id: "translate", label: "AI translation..." },
    { id: "tts", label: "Generating Spanish audio..." },
    { id: "merge", label: "Mixing audio..." },
    { id: "render", label: "Rendering video..." },
  ];

  // ============================================
  // RENDER
  // ============================================

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="logo">
          <div className="logo-icon">🌊</div>
          <span className="logo-text">immerse</span>
        </div>
        <div className="mode-toggle">
          <button
            className={`mode-btn ${appMode === "user" ? "active" : ""}`}
            onClick={() => setAppMode("user")}
            title="Simplified interface"
          >
            <User size={16} />
            Simple
          </button>
          <button
            className={`mode-btn ${appMode === "dev" ? "active" : ""}`}
            onClick={() => setAppMode("dev")}
            title="Full control - all features"
          >
            <Code size={16} />
            Dev
          </button>
        </div>
      </header>

      <main className="main">
        {/* ============================================
            USER MODE - Simplified Interface
            ============================================ */}
        {appMode === "user" && !result && !isProcessing && (
          <>
            {/* Hero */}
            <section className="hero">
              <h1>
                Turn any video into <span>comprehensible input</span>
              </h1>
              <p>
                Paste a link, pick your plan, and get a dubbed video in minutes.
              </p>
            </section>

            {/* Tier Selection Cards */}
            <div className="tier-cards">
              {Object.values(TIER_INFO).map((tier) => (
                <div
                  key={tier.id}
                  className={`tier-card ${selectedTier === tier.id ? "selected" : ""}`}
                  onClick={() => {
                    setSelectedTier(tier.id);
                    setLevel(tier.defaultLevel);
                  }}
                  style={{
                    "--tier-color": tier.color,
                    "--tier-gradient": tier.gradient,
                  }}
                >
                  {selectedTier === tier.id && (
                    <div className="tier-selected-badge">
                      <Check size={14} />
                    </div>
                  )}
                  <div className="tier-icon">{tier.icon}</div>
                  <h3 className="tier-name">{tier.name}</h3>
                  <p className="tier-tagline">{tier.tagline}</p>
                  <p className="tier-description">{tier.description}</p>
                  <ul className="tier-features">
                    {tier.features.map((f, i) => (
                      <li key={i}>
                        <Check size={14} />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div className="tier-cost">{tier.cost}</div>
                </div>
              ))}
            </div>

            {/* Simple Input Card */}
            <div className="user-input-card">
              {/* Input Type Toggle */}
              <div className="user-input-tabs">
                <button
                  className={`user-tab ${inputType === "url" ? "active" : ""}`}
                  onClick={() => setInputType("url")}
                >
                  <Youtube size={18} />
                  Paste URL
                </button>
                <button
                  className={`user-tab ${inputType === "file" ? "active" : ""}`}
                  onClick={() => setInputType("file")}
                >
                  <Upload size={18} />
                  Upload
                </button>
              </div>

              {/* URL Input */}
              {inputType === "url" && (
                <div className="user-input-row">
                  <div className="input-wrapper" style={{ flex: 1 }}>
                    <span className="input-icon">
                      <Link size={20} />
                    </span>
                    <input
                      type="url"
                      className="input"
                      placeholder="https://youtube.com/watch?v=..."
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* File Upload */}
              {inputType === "file" && (
                <div
                  className={`file-upload ${uploadedFile ? "has-file" : ""}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleFileDrop}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.add("dragover");
                  }}
                  onDragLeave={(e) =>
                    e.currentTarget.classList.remove("dragover")
                  }
                >
                  {uploadedFile ? (
                    <div className="file-selected">
                      <Film size={24} />
                      <div>
                        <p>{uploadedFile.name}</p>
                        <span>
                          {(uploadedFile.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                      </div>
                      <button
                        className="file-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          setUploadedFile(null);
                        }}
                      >
                        <X size={18} />
                      </button>
                    </div>
                  ) : (
                    <>
                      <Upload className="file-upload-icon" size={48} />
                      <p>Drop your file here or click to browse</p>
                      <span>MP4, MKV, WebM, MOV, MP3, WAV</span>
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".mp4,.mkv,.webm,.mov,.avi,.mp3,.wav,.m4a"
                    onChange={handleFileSelect}
                  />
                </div>
              )}

              {/* Simple Options Row */}
              <div className="user-options-row">
                <div className="select-group">
                  <label className="select-label">Language</label>
                  <select
                    className="select"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="select-group">
                  <label className="select-label">Level</label>
                  <select
                    className="select"
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                  >
                    {(TIER_INFO[selectedTier]?.levels || ["B1"]).map((l) => {
                      const levelInfo = LEVELS.find((lv) => lv.value === l);
                      return (
                        <option key={l} value={l}>
                          {levelInfo ? levelInfo.label : l}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {/* Submit */}
              <button
                className="btn btn-primary user-submit-btn"
                onClick={handleUserSubmit}
                disabled={
                  isProcessing ||
                  (inputType === "url" && !url) ||
                  (inputType === "file" && !uploadedFile)
                }
              >
                <Zap size={20} />
                Start Dubbing
              </button>

              {/* Error */}
              {error && (
                <div className="error-message">
                  <AlertCircle size={20} />
                  {error}
                </div>
              )}
            </div>
          </>
        )}

        {/* ============================================
            DEV MODE - Full Control Interface
            ============================================ */}
        {appMode === "dev" && !result && !isProcessing && (
          <>
            {/* Hero */}
            <section className="hero">
              <h1>
                Turn any video into <span>comprehensible Spanish</span>
              </h1>
              <p>
                Paste a YouTube link or upload a video, choose your level, and
                get a professionally dubbed video in minutes.
              </p>
            </section>
          </>
        )}

        {appMode === "dev" && (
          <div className={`upload-card ${result || isProcessing ? "" : ""}`}>
            {/* Input Type Toggle */}
            <div className="tabs">
              <button
                className={`tab ${inputType === "url" ? "active" : ""}`}
                onClick={() => setInputType("url")}
              >
                <Youtube size={18} />
                URL
              </button>
              <button
                className={`tab ${inputType === "file" ? "active" : ""}`}
                onClick={() => setInputType("file")}
              >
                <Upload size={18} />
                Upload File
              </button>
              <button
                className={`tab ${inputType === "extract-voice" ? "active" : ""}`}
                onClick={() => setInputType("extract-voice")}
              >
                <Mic size={18} />
                Extract Voice
              </button>
            </div>

            <div className="upload-content">
              {/* Voice Extraction Tab - Standalone, no pipeline options */}
              {inputType === "extract-voice" && (
                <div className="voice-extraction-section animate-fade-in">
                  <div className="section-header">
                    <h3>🎤 Voice Sample Extractor</h3>
                    <p>
                      Automatically finds the best voice samples for cloning
                    </p>
                  </div>

                  {/* Source Type Toggle */}
                  <div className="extraction-source-toggle">
                    <button
                      className={`source-btn ${extractionSource === "file" ? "active" : ""}`}
                      onClick={() => setExtractionSource("file")}
                    >
                      <Upload size={18} />
                      Upload File
                    </button>
                    <button
                      className={`source-btn ${extractionSource === "youtube" ? "active" : ""}`}
                      onClick={() => setExtractionSource("youtube")}
                    >
                      <Youtube size={18} />
                      YouTube URL
                    </button>
                  </div>

                  {/* File Upload */}
                  {extractionSource === "file" && (
                    <div className="input-group">
                      <div
                        className={`file-upload ${extractionFile ? "has-file" : ""}`}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {extractionFile ? (
                          <div className="file-selected">
                            <Film size={24} />
                            <div>
                              <p>{extractionFile.name}</p>
                              <span>
                                {(extractionFile.size / 1024 / 1024).toFixed(1)}{" "}
                                MB
                              </span>
                            </div>
                            <button
                              className="file-remove"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExtractionFile(null);
                                setVoiceSamples([]);
                              }}
                            >
                              <X size={18} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <Upload className="file-upload-icon" size={48} />
                            <p>Drop video/audio file here</p>
                            <span>MP4, MKV, WebM, MP3, WAV</span>
                          </>
                        )}
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".mp4,.mkv,.webm,.mov,.avi,.mp3,.wav,.m4a"
                          onChange={(e) =>
                            setExtractionFile(e.target.files?.[0])
                          }
                        />
                      </div>
                    </div>
                  )}

                  {/* YouTube URL Input */}
                  {extractionSource === "youtube" && (
                    <div className="input-group">
                      <div className="input-wrapper">
                        <span className="input-icon">
                          <Youtube size={20} />
                        </span>
                        <input
                          type="url"
                          className="input"
                          placeholder="https://youtube.com/watch?v=..."
                          value={extractionUrl}
                          onChange={(e) => setExtractionUrl(e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  {/* Extract Button */}
                  <button
                    className="btn btn-primary"
                    onClick={handleExtractVoice}
                    disabled={
                      isExtracting ||
                      (extractionSource === "file"
                        ? !extractionFile
                        : !extractionUrl)
                    }
                  >
                    {isExtracting ? (
                      <>
                        <span className="spinner" />
                        Analyzing & Extracting...
                      </>
                    ) : (
                      <>
                        <Sparkles size={20} />
                        Auto-Extract Best Samples
                      </>
                    )}
                  </button>

                  {/* Error Message */}
                  {error && (
                    <div className="error-message">
                      <AlertCircle size={20} />
                      {error}
                    </div>
                  )}

                  {/* Voice Samples Display */}
                  {voiceSamples.length > 0 && (
                    <div className="voice-samples-results animate-fade-in">
                      <h4>
                        🎧{" "}
                        {extractionSpeakers.length > 1
                          ? `${extractionSpeakers.length} Speakers Detected`
                          : "Samples"}{" "}
                        (Best → Worst)
                      </h4>

                      {extractionSpeakers.length > 1 && (
                        <div className="speakers-info">
                          {extractionSpeakers.map((speaker) => {
                            const speakerSamples = voiceSamples.filter(
                              (s) => s.speaker === speaker,
                            );
                            return (
                              <div key={speaker} className="speaker-tag">
                                {speaker}: {speakerSamples.length} samples
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div className="samples-grid">
                        {voiceSamples.map((sample, index) => (
                          <div
                            key={sample.id}
                            className={`sample-card ${selectedSample === sample.id ? "selected" : ""}`}
                            onClick={() => setSelectedSample(sample.id)}
                          >
                            <div className="sample-header">
                              <span className="sample-rank">
                                {index === 0
                                  ? "🥇"
                                  : index === 1
                                    ? "🥈"
                                    : index === 2
                                      ? "🥉"
                                      : `${index + 1}.`}
                              </span>
                              <span
                                className="sample-score"
                                style={{
                                  color:
                                    sample.qualityScore >= 80
                                      ? "#10b981"
                                      : sample.qualityScore >= 60
                                        ? "#3b82f6"
                                        : sample.qualityScore >= 40
                                          ? "#f59e0b"
                                          : "#ef4444",
                                }}
                              >
                                {sample.qualityScore}/100
                              </span>
                            </div>

                            <div className="sample-info">
                              {sample.speaker &&
                                extractionSpeakers.length > 1 && (
                                  <p className="sample-speaker">
                                    {sample.speaker}
                                  </p>
                                )}
                              <p className="sample-time">
                                {sample.startTime}s • {sample.duration}s
                              </p>
                              {sample.text && (
                                <p className="sample-text">"{sample.text}"</p>
                              )}

                              <audio
                                ref={(el) => {
                                  if (el) audioRefs[sample.id] = el;
                                }}
                                src={
                                  sample.url.startsWith("/api")
                                    ? sample.url
                                    : `${sample.url}`
                                }
                              />

                              <button
                                className="btn-play-sample"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSampleAudio(sample.id);
                                }}
                              >
                                <Play size={16} />
                                Play
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <button
                        className="btn btn-accent"
                        onClick={() => {
                          const selected = voiceSamples.find(
                            (s) => s.id === selectedSample,
                          );
                          if (selected) {
                            // Switch to URL tab and set voice source
                            setInputType("url");
                            setTtsProvider("xtts"); // Enable XTTS
                            setVoiceSource("file");

                            // Store the sample URL directly - the server will use it
                            setSelectedVoiceSampleUrl(selected.url);

                            // Also clear any previously uploaded file
                            setCustomVoiceFile(null);

                            // Let the user know
                            alert(
                              `Voice sample selected! Now enter the video URL you want to dub and click Process.`,
                            );
                          }
                        }}
                        disabled={!selectedSample}
                      >
                        <Check size={20} />
                        Use for Voice Cloning
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* URL Input */}
              {inputType === "url" && (
                <div className="input-group animate-fade-in">
                  <label className="input-label">
                    Video URL (YouTube, TikTok, etc.)
                  </label>
                  <div className="input-wrapper">
                    <span className="input-icon">
                      <Link size={20} />
                    </span>
                    <input
                      type="url"
                      className="input"
                      placeholder="https://youtube.com/watch?v=... or any video URL"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                  </div>
                  {selectedVoiceSampleUrl && ttsProvider === "xtts" && (
                    <div
                      className="hint-text"
                      style={{ color: "var(--accent)", marginTop: "0.5rem" }}
                    >
                      ✅ Voice sample selected for cloning. Will use XTTS.
                      <button
                        className="btn-link"
                        onClick={() => {
                          setSelectedVoiceSampleUrl(null);
                          setTtsProvider("standard");
                        }}
                        style={{
                          marginLeft: "1rem",
                          textDecoration: "underline",
                          cursor: "pointer",
                          background: "none",
                          border: "none",
                          color: "var(--text-muted)",
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* File Upload */}
              {inputType === "file" && (
                <div className="input-group animate-fade-in">
                  <label className="input-label">Upload Video/Audio File</label>
                  <div
                    className={`file-upload ${uploadedFile ? "has-file" : ""}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDrop={handleFileDrop}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.currentTarget.classList.add("dragover");
                    }}
                    onDragLeave={(e) =>
                      e.currentTarget.classList.remove("dragover")
                    }
                  >
                    {uploadedFile ? (
                      <div className="file-selected">
                        <Film size={24} />
                        <div>
                          <p>{uploadedFile.name}</p>
                          <span>
                            {(uploadedFile.size / 1024 / 1024).toFixed(1)} MB
                          </span>
                        </div>
                        <button
                          className="file-remove"
                          onClick={(e) => {
                            e.stopPropagation();
                            setUploadedFile(null);
                          }}
                        >
                          <X size={18} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <Upload className="file-upload-icon" size={48} />
                        <p>Drop your file here or click to browse</p>
                        <span>MP4, MKV, WebM, MOV, MP3, WAV up to 500MB</span>
                      </>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".mp4,.mkv,.webm,.mov,.avi,.mp3,.wav,.m4a"
                      onChange={handleFileSelect}
                    />
                  </div>
                </div>
              )}

              {/* Main Pipeline Options - Only show for URL and File modes */}
              {inputType !== "extract-voice" && (
                <>
                  {/* Main Options Grid */}
                  <div className="options-grid">
                    {/* Level */}
                    <div className="select-group">
                      <label className="select-label">Level</label>
                      <select
                        className="select"
                        value={level}
                        onChange={(e) => setLevel(e.target.value)}
                      >
                        {LEVELS.map((l) => (
                          <option key={l.value} value={l.value}>
                            {l.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Mode */}
                    <div className="select-group">
                      <label className="select-label">Mode</label>
                      <select
                        className="select"
                        value={mode}
                        onChange={(e) => setMode(e.target.value)}
                      >
                        {MODES.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.icon} {m.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Voice */}
                    <div className="select-group">
                      <label className="select-label">Voice</label>
                      <select
                        className="select"
                        value={voice}
                        onChange={(e) => setVoice(e.target.value)}
                      >
                        {VOICES.map((v) => (
                          <option key={v.value} value={v.value}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Language */}
                    <div className="select-group">
                      <label className="select-label">Language</label>
                      <select
                        className="select"
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                      >
                        {LANGUAGES.map((l) => (
                          <option key={l.value} value={l.value}>
                            {l.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* TTS Provider (mutually exclusive) */}
                  <div className="flags-section">
                    <label className="select-label">TTS Provider</label>
                    <div className="flags-grid">
                      {TTS_PROVIDERS.map((provider) => (
                        <button
                          key={provider.value}
                          className={`flag-btn ${ttsProvider === provider.value ? "active" : ""}`}
                          onClick={() => {
                            setTtsProvider(provider.value);
                            setSpecificVoice("");
                          }}
                          title={provider.desc}
                        >
                          <span className="flag-icon">{provider.icon}</span>
                          <span className="flag-label">{provider.label}</span>
                        </button>
                      ))}
                    </div>
                    <p className="flags-hint">
                      {ttsProvider === "default" &&
                        "Fast preset voices (Lemonfox)"}
                      {ttsProvider === "premium" &&
                        "Higher quality voices (ElevenLabs) - ~$0.30/min"}
                      {ttsProvider === "clone" &&
                        "Clone original speaker's voice (XTTS) - best for single speaker"}
                    </p>
                  </div>

                  {/* Specific Voice Selector (shown for default/premium, not clone) */}
                  {SPECIFIC_VOICES[ttsProvider] && (
                    <div className="select-group animate-fade-in">
                      <label className="select-label">
                        {SPECIFIC_VOICES[ttsProvider].label}
                      </label>
                      <select
                        className="select"
                        value={specificVoice}
                        onChange={(e) => setSpecificVoice(e.target.value)}
                      >
                        {SPECIFIC_VOICES[ttsProvider].voices.map((v) => (
                          <option key={v.value} value={v.value}>
                            {v.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Narrator Mode Options (shown when clone or narrator mode selected) */}
                  {showNarratorOptions && (
                    <div className="narrator-section animate-fade-in">
                      <label className="select-label">Narrator Style</label>
                      <div className="narrator-grid">
                        {NARRATOR_MODES.map((nm) => (
                          <button
                            key={nm.value}
                            className={`narrator-btn ${narratorMode === nm.value ? "active" : ""}`}
                            onClick={() => setNarratorMode(nm.value)}
                            title={nm.desc}
                          >
                            <span className="narrator-icon">{nm.icon}</span>
                            <div className="narrator-content">
                              <span className="narrator-label">{nm.label}</span>
                              <span className="narrator-hint">{nm.hint}</span>
                            </div>
                          </button>
                        ))}
                      </div>

                      {/* Custom Voice Options (shown for custom_narrator mode) */}
                      {narratorMode === "custom_narrator" && (
                        <div className="voice-source-section animate-fade-in">
                          <label className="select-label">Voice Source</label>
                          <div className="voice-source-tabs">
                            {VOICE_SOURCES.map((vs) => (
                              <button
                                key={vs.value}
                                className={`voice-tab ${voiceSource === vs.value ? "active" : ""}`}
                                onClick={() => setVoiceSource(vs.value)}
                              >
                                {vs.label}
                              </button>
                            ))}
                          </div>

                          {/* Video source - just needs timing */}
                          {voiceSource === "video" && (
                            <div className="voice-timing animate-fade-in">
                              <p className="voice-hint">
                                Extract voice from the input video. Choose when
                                to sample:
                              </p>
                              <div className="voice-timing-inputs">
                                <div className="select-group">
                                  <label className="select-label">
                                    Start (seconds)
                                  </label>
                                  <input
                                    type="text"
                                    className="input no-icon"
                                    placeholder="30"
                                    value={voiceStartTime}
                                    onChange={(e) =>
                                      setVoiceStartTime(e.target.value)
                                    }
                                  />
                                </div>
                                <div className="select-group">
                                  <label className="select-label">
                                    Duration (seconds)
                                  </label>
                                  <input
                                    type="text"
                                    className="input no-icon"
                                    placeholder="15"
                                    value={voiceDuration}
                                    onChange={(e) =>
                                      setVoiceDuration(e.target.value)
                                    }
                                  />
                                </div>
                              </div>
                            </div>
                          )}

                          {/* File upload for custom voice */}
                          {voiceSource === "file" && (
                            <div className="voice-file-upload animate-fade-in">
                              <p className="voice-hint">
                                Upload a 6-30 second audio sample of the voice
                                you want to clone:
                              </p>
                              <div
                                className={`file-upload small ${customVoiceFile ? "has-file" : ""}`}
                                onClick={() =>
                                  voiceFileInputRef.current?.click()
                                }
                              >
                                {customVoiceFile ? (
                                  <div className="file-selected">
                                    <Mic size={20} />
                                    <div>
                                      <p>{customVoiceFile.name}</p>
                                      <span>
                                        {(customVoiceFile.size / 1024).toFixed(
                                          0,
                                        )}{" "}
                                        KB
                                      </span>
                                    </div>
                                    <button
                                      className="file-remove"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setCustomVoiceFile(null);
                                      }}
                                    >
                                      <X size={16} />
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <Headphones size={32} />
                                    <p>Click to upload voice sample</p>
                                    <span>MP3, WAV, M4A • 6-30 seconds</span>
                                  </>
                                )}
                                <input
                                  ref={voiceFileInputRef}
                                  type="file"
                                  accept=".mp3,.wav,.m4a,.aac,.ogg,.flac"
                                  onChange={handleVoiceFileSelect}
                                />
                              </div>
                            </div>
                          )}

                          {/* YouTube URL for voice extraction */}
                          {voiceSource === "youtube" && (
                            <div className="voice-youtube animate-fade-in">
                              <div className="input-wrapper">
                                <span className="input-icon">
                                  <Youtube size={20} />
                                </span>
                                <input
                                  type="url"
                                  className="input"
                                  placeholder="https://youtube.com/watch?v=..."
                                  value={customVoiceUrl}
                                  onChange={(e) =>
                                    setCustomVoiceUrl(e.target.value)
                                  }
                                />
                              </div>

                              {/* Auto / Manual toggle */}
                              <label
                                className="checkbox-label"
                                style={{ marginTop: "0.75rem" }}
                              >
                                <input
                                  type="checkbox"
                                  checked={youtubeVoiceManual}
                                  onChange={(e) =>
                                    setYoutubeVoiceManual(e.target.checked)
                                  }
                                />
                                <span>
                                  Manual mode (specify exact clip time)
                                </span>
                              </label>

                              {/* AUTO MODE: Find best voice clips automatically */}
                              {!youtubeVoiceManual && (
                                <>
                                  <p
                                    className="voice-hint"
                                    style={{ marginTop: "0.5rem" }}
                                  >
                                    Auto-detect the best voice clips from this
                                    video:
                                  </p>
                                  <button
                                    className="btn btn-secondary"
                                    style={{
                                      marginTop: "0.5rem",
                                      width: "100%",
                                    }}
                                    disabled={!customVoiceUrl || isExtracting}
                                    onClick={async () => {
                                      setIsExtracting(true);
                                      setError(null);
                                      try {
                                        const formData = new FormData();
                                        formData.append("url", customVoiceUrl);
                                        formData.append("mode", "auto");
                                        formData.append(
                                          "samplesPerSpeaker",
                                          "3",
                                        );
                                        const response = await fetch(
                                          `${API_URL}/v2/extract-voice`,
                                          {
                                            method: "POST",
                                            body: formData,
                                          },
                                        );
                                        if (!response.ok)
                                          throw new Error("Extraction failed");
                                        const data = await response.json();
                                        setVoiceSamples(data.samples || []);
                                        setExtractionSpeakers(
                                          data.speakers || [],
                                        );
                                      } catch (err) {
                                        setError(
                                          `Voice extraction failed: ${err.message}`,
                                        );
                                      } finally {
                                        setIsExtracting(false);
                                      }
                                    }}
                                  >
                                    {isExtracting ? (
                                      <>
                                        <span className="spinner" /> Analyzing
                                        voices...
                                      </>
                                    ) : (
                                      <>
                                        <Mic size={16} /> Find Voices
                                      </>
                                    )}
                                  </button>

                                  {/* Inline voice sample results */}
                                  {voiceSamples.length > 0 &&
                                    voiceSource === "youtube" && (
                                      <div
                                        className="voice-samples-results animate-fade-in"
                                        style={{ marginTop: "1rem" }}
                                      >
                                        <h4
                                          style={{
                                            fontSize: "0.9rem",
                                            marginBottom: "0.5rem",
                                          }}
                                        >
                                          {extractionSpeakers.length > 1
                                            ? `${extractionSpeakers.length} Speakers Found`
                                            : "Voice Samples"}{" "}
                                          - Click to select:
                                        </h4>
                                        <div className="samples-grid">
                                          {voiceSamples.map((sample, index) => (
                                            <div
                                              key={sample.id}
                                              className={`sample-card ${selectedSample === sample.id ? "selected" : ""}`}
                                              onClick={() => {
                                                setSelectedSample(sample.id);
                                                setSelectedVoiceSampleUrl(
                                                  sample.url,
                                                );
                                              }}
                                            >
                                              <div className="sample-header">
                                                <span className="sample-rank">
                                                  {index === 0
                                                    ? "🥇"
                                                    : index === 1
                                                      ? "🥈"
                                                      : index === 2
                                                        ? "🥉"
                                                        : `${index + 1}.`}
                                                </span>
                                                <span
                                                  className="sample-score"
                                                  style={{
                                                    color:
                                                      sample.qualityScore >= 80
                                                        ? "#10b981"
                                                        : sample.qualityScore >=
                                                            60
                                                          ? "#3b82f6"
                                                          : "#f59e0b",
                                                  }}
                                                >
                                                  {sample.qualityScore}/100
                                                </span>
                                              </div>
                                              <div className="sample-info">
                                                {sample.speaker &&
                                                  extractionSpeakers.length >
                                                    1 && (
                                                    <p className="sample-speaker">
                                                      {sample.speaker}
                                                    </p>
                                                  )}
                                                <p className="sample-time">
                                                  {sample.startTime}s •{" "}
                                                  {sample.duration}s
                                                </p>
                                                {sample.text && (
                                                  <p className="sample-text">
                                                    "{sample.text}"
                                                  </p>
                                                )}
                                                <audio
                                                  ref={(el) => {
                                                    if (el)
                                                      audioRefs[sample.id] = el;
                                                  }}
                                                  src={
                                                    sample.url.startsWith(
                                                      "/api",
                                                    )
                                                      ? sample.url
                                                      : `${sample.url}`
                                                  }
                                                />
                                                <button
                                                  className="btn-play-sample"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleSampleAudio(
                                                      sample.id,
                                                    );
                                                  }}
                                                >
                                                  <Play size={16} /> Play
                                                </button>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                        {selectedSample && (
                                          <p
                                            style={{
                                              color: "var(--accent)",
                                              fontSize: "0.85rem",
                                              marginTop: "0.5rem",
                                            }}
                                          >
                                            ✅ Voice selected. This will be used
                                            for cloning.
                                          </p>
                                        )}
                                      </div>
                                    )}
                                </>
                              )}

                              {/* MANUAL MODE: Specify exact start/duration */}
                              {youtubeVoiceManual && (
                                <div style={{ marginTop: "0.5rem" }}>
                                  <p className="voice-hint">
                                    Specify the exact clip time to extract voice
                                    from:
                                  </p>
                                  <div
                                    className="voice-timing-inputs"
                                    style={{ marginTop: "0.5rem" }}
                                  >
                                    <div className="select-group">
                                      <label className="select-label">
                                        Start (seconds)
                                      </label>
                                      <input
                                        type="text"
                                        className="input no-icon"
                                        placeholder="30"
                                        value={voiceStartTime}
                                        onChange={(e) =>
                                          setVoiceStartTime(e.target.value)
                                        }
                                      />
                                    </div>
                                    <div className="select-group">
                                      <label className="select-label">
                                        Duration (seconds)
                                      </label>
                                      <input
                                        type="text"
                                        className="input no-icon"
                                        placeholder="15"
                                        value={voiceDuration}
                                        onChange={(e) =>
                                          setVoiceDuration(e.target.value)
                                        }
                                      />
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Narrator mode hints */}
                      <div className="narrator-mode-hint">
                        {narratorMode === "clone_speaker" && (
                          <p>
                            🎭 <strong>1st Person:</strong> "I went to the
                            store" → "Fui a la tienda"
                          </p>
                        )}
                        {narratorMode === "third_party" && (
                          <p>
                            🎙️ <strong>3rd Person:</strong> "I went to the
                            store" → "Él fue a la tienda"
                          </p>
                        )}
                        {narratorMode === "custom_narrator" && (
                          <p>
                            🎨 <strong>Custom:</strong> Use any voice you want
                            for narration
                          </p>
                        )}
                        {narratorMode === "storyteller" && (
                          <p>
                            📖 <strong>Hybrid:</strong> Action in 3rd person,
                            dialogue quoted in 1st person
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Enhancement Flags */}
                  <div className="flags-section">
                    <label className="select-label">Enhancements</label>
                    <div className="flags-grid">
                      {ENHANCEMENT_FLAGS.map((flag) => (
                        <button
                          key={flag.value}
                          className={`flag-btn ${flags.includes(flag.value) ? "active" : ""}`}
                          onClick={() => toggleFlag(flag.value)}
                          title={flag.desc}
                        >
                          <span className="flag-icon">{flag.icon}</span>
                          <span className="flag-label">{flag.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* TikTok Format Section */}
                  <div className="tiktok-section">
                    <label className="select-label">
                      🎬 TikTok Format
                      <span className="optional-badge">Optional</span>
                    </label>
                    <p className="section-hint">
                      Convert output to vertical TikTok format (9:16)
                    </p>

                    <div className="select-group">
                      <label className="select-label">Style</label>
                      <select
                        className="select"
                        value={tiktokStyle}
                        onChange={(e) => setTiktokStyle(e.target.value)}
                      >
                        {TIKTOK_STYLES.map((style) => (
                          <option key={style.value} value={style.value}>
                            {style.icon ? `${style.icon} ` : ""}
                            {style.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {tiktokStyle !== "none" && (
                      <div className="tiktok-options animate-fade-in">
                        <div className="select-group">
                          <label className="select-label">Background</label>
                          <select
                            className="select"
                            value={tiktokBackground}
                            onChange={(e) =>
                              setTiktokBackground(e.target.value)
                            }
                          >
                            {TIKTOK_BACKGROUNDS.map((bg) => (
                              <option key={bg.value} value={bg.value}>
                                {bg.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="select-group">
                          <label className="select-label">
                            Top Text (optional)
                          </label>
                          <input
                            type="text"
                            className="input no-icon"
                            placeholder="POV: You speak Spanish now"
                            value={tiktokTopText}
                            onChange={(e) => setTiktokTopText(e.target.value)}
                          />
                        </div>

                        <div className="select-group">
                          <label className="select-label">
                            Bottom Text (optional)
                          </label>
                          <input
                            type="text"
                            className="input no-icon"
                            placeholder="Follow for more!"
                            value={tiktokBottomText}
                            onChange={(e) =>
                              setTiktokBottomText(e.target.value)
                            }
                          />
                        </div>

                        {/* Hook Mode */}
                        <div className="tiktok-features">
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={addHook}
                              onChange={(e) => setAddHook(e.target.checked)}
                            />
                            <span>🔥 Add Hook (First 3 seconds)</span>
                          </label>
                          <p className="feature-hint">
                            AI generates an attention-grabbing hook for the
                            start of your video
                          </p>

                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={generateMetadata}
                              onChange={(e) =>
                                setGenerateMetadata(e.target.checked)
                              }
                            />
                            <span>📝 Generate TikTok Metadata</span>
                          </label>
                          <p className="feature-hint">
                            AI creates caption, hashtags, and recommended
                            overlay text
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Advanced Options Toggle */}
                  <button
                    className="advanced-toggle"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                  >
                    <Settings size={16} />
                    {showAdvanced ? "Hide" : "Show"} Advanced Options
                  </button>

                  {/* Advanced Options */}
                  {showAdvanced && (
                    <div className="advanced-options animate-fade-in">
                      <div className="options-grid">
                        <div className="select-group">
                          <label className="select-label">Start Time</label>
                          <input
                            type="text"
                            className="input no-icon"
                            placeholder="e.g., 1:30 or 90"
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                          />
                        </div>
                        <div className="select-group">
                          <label className="select-label">Duration</label>
                          <input
                            type="text"
                            className="input no-icon"
                            placeholder="e.g., 5:00 or 300"
                            value={duration}
                            onChange={(e) => setDuration(e.target.value)}
                          />
                        </div>
                        <div className="select-group">
                          <label className="select-label">Speakers</label>
                          <input
                            type="text"
                            className="input no-icon"
                            placeholder="auto or 2, 3..."
                            value={speakers}
                            onChange={(e) => setSpeakers(e.target.value)}
                          />
                        </div>
                        <div className="select-group">
                          <label className="select-label">Assign Voices</label>
                          <input
                            type="text"
                            className="input no-icon"
                            placeholder="adam,veronica,josh"
                            value={assignVoices}
                            onChange={(e) => setAssignVoices(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Submit Button - Only for URL/File modes */}
              {inputType !== "extract-voice" && !result && (
                <button
                  className="btn btn-primary"
                  onClick={handleSubmit}
                  disabled={
                    isProcessing ||
                    (inputType === "url" && !url) ||
                    (inputType === "file" && !uploadedFile)
                  }
                >
                  {isProcessing ? (
                    <>
                      <span className="spinner" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Play size={20} />
                      Start Immersing
                    </>
                  )}
                </button>
              )}

              {/* Reset Button */}
              {result && (
                <button
                  className="btn btn-secondary"
                  onClick={handleReset}
                  style={{ width: "100%" }}
                >
                  <RefreshCw size={18} />
                  Process Another Video
                </button>
              )}

              {/* Error Message */}
              {error && (
                <div className="error-message">
                  <AlertCircle size={20} />
                  {error}
                </div>
              )}

              {/* Progress Section */}
              {isProcessing && (
                <div className="progress-section">
                  <div className="progress-header">
                    <span className="progress-title">{currentStep}</span>
                    <span className="progress-status">{progress}%</span>
                  </div>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  {jobId && <p className="job-id">Job ID: {jobId}</p>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* User Mode Progress (shown outside the dev card) */}
        {appMode === "user" && isProcessing && (
          <div className="user-progress-card">
            <div className="user-progress-header">
              <div className="user-progress-icon">
                <span className="spinner large" />
              </div>
              <h3>Dubbing your video...</h3>
              <p className="user-progress-step">{currentStep}</p>
            </div>
            <div className="progress-bar large">
              <div
                className="progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="user-progress-percent">{progress}%</div>
          </div>
        )}

        {/* Results Section */}
        {result && (
          <section className="player-section">
            <div className="player-card">
              <div className="player-header">
                <div className="player-title">
                  <h3>Your Dubbed Content</h3>
                  <span className="player-badge">
                    {level} • {mode}
                  </span>
                </div>
                <div className="player-actions">
                  {!hasSeparateTracks && (
                    <button
                      className="btn-icon"
                      onClick={() => setIsMuted(!isMuted)}
                    >
                      {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
                    </button>
                  )}
                  {result.videoUrl && (
                    <a
                      href={result.videoUrl}
                      download
                      className="btn-icon"
                      title="Download Video (mixed audio)"
                    >
                      <Film size={20} />
                    </a>
                  )}
                  {result.audioUrl && (
                    <a
                      href={result.audioUrl}
                      download
                      className="btn-icon"
                      title="Download Audio"
                    >
                      <Download size={20} />
                    </a>
                  )}
                </div>
              </div>

              {/* Video Player */}
              {result.videoUrl && (
                <div className="video-container">
                  <video
                    ref={videoRef}
                    src={result.videoUrl}
                    onTimeUpdate={() =>
                      setCurrentTime(videoRef.current?.currentTime || 0)
                    }
                    onLoadedMetadata={() =>
                      setVideoDuration(videoRef.current?.duration || 0)
                    }
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    muted={hasSeparateTracks ? true : isMuted}
                    playsInline
                  />
                </div>
              )}

              {/* Audio-only Player (fallback when no separate tracks) */}
              {result.audioUrl && !result.videoUrl && !hasSeparateTracks && (
                <div className="audio-only-player">
                  <div className="audio-artwork">
                    <div className="audio-artwork-icon">🎧</div>
                    <div className="audio-artwork-waves">
                      <span></span>
                      <span></span>
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                  <audio
                    ref={audioRef}
                    src={result.audioUrl}
                    onTimeUpdate={() =>
                      setCurrentTime(audioRef.current?.currentTime || 0)
                    }
                    onLoadedMetadata={() =>
                      setVideoDuration(audioRef.current?.duration || 0)
                    }
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                  />
                </div>
              )}

              {/* Audio-only with separate tracks (no video) */}
              {!result.videoUrl && hasSeparateTracks && (
                <div className="audio-only-player">
                  <div className="audio-artwork">
                    <div className="audio-artwork-icon">🎧</div>
                    <div className="audio-artwork-waves">
                      <span></span>
                      <span></span>
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                </div>
              )}

              {/* Separate audio tracks for independent volume control */}
              {hasSeparateTracks && (
                <>
                  <audio
                    ref={voiceAudioRef}
                    src={result.voiceOnlyUrl}
                    preload="auto"
                    onTimeUpdate={() => {
                      if (!result.videoUrl)
                        setCurrentTime(voiceAudioRef.current?.currentTime || 0);
                    }}
                    onLoadedMetadata={() => {
                      if (voiceAudioRef.current) {
                        voiceAudioRef.current.volume = voiceVolume;
                        if (!result.videoUrl)
                          setVideoDuration(voiceAudioRef.current.duration || 0);
                      }
                    }}
                    onPlay={() => {
                      if (!result.videoUrl) setIsPlaying(true);
                    }}
                    onPause={() => {
                      if (!result.videoUrl) setIsPlaying(false);
                    }}
                  />
                  <audio
                    ref={bgAudioRef}
                    src={result.backgroundUrl}
                    preload="auto"
                    onLoadedMetadata={() => {
                      if (bgAudioRef.current)
                        bgAudioRef.current.volume = bgVolume;
                    }}
                  />
                </>
              )}

              {/* Player Controls */}
              <div className="player-controls">
                <button className="play-btn" onClick={togglePlay}>
                  {isPlaying ? <Pause size={24} /> : <Play size={24} />}
                </button>
                <div className="timeline">
                  <div className="timeline-bar" onClick={handleSeek}>
                    <div
                      className="timeline-progress"
                      style={{
                        width: `${videoDuration ? (currentTime / videoDuration) * 100 : 0}%`,
                      }}
                    >
                      <div className="timeline-thumb" />
                    </div>
                  </div>
                  <div className="timeline-times">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(videoDuration)}</span>
                  </div>
                </div>
                <div className="speed-control">
                  <span className="speed-label">Speed</span>
                  <div className="speed-buttons">
                    {SPEEDS.map((speed) => (
                      <button
                        key={speed}
                        className={`speed-btn ${playbackSpeed === speed ? "active" : ""}`}
                        onClick={() => setPlaybackSpeed(speed)}
                      >
                        {speed}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Volume Mixer - separate voice & background controls */}
              {hasSeparateTracks && (
                <div className="volume-mixer">
                  <div className="mixer-row">
                    <button
                      className={`mixer-toggle ${voiceVolume === 0 ? "muted" : ""}`}
                      onClick={() => {
                        if (voiceVolume === 0) {
                          setVoiceVolume(prevVoiceVolume.current || 0.85);
                        } else {
                          prevVoiceVolume.current = voiceVolume;
                          setVoiceVolume(0);
                        }
                      }}
                      title={voiceVolume === 0 ? "Unmute voice" : "Mute voice"}
                    >
                      {voiceVolume === 0 ? (
                        <MicOff size={16} />
                      ) : (
                        <Mic size={16} />
                      )}
                    </button>
                    <div className="mixer-label">
                      <span>Voice</span>
                    </div>
                    <input
                      type="range"
                      className="mixer-slider voice-slider"
                      min="0"
                      max="1"
                      step="0.01"
                      value={voiceVolume}
                      onChange={(e) =>
                        setVoiceVolume(parseFloat(e.target.value))
                      }
                      style={{ backgroundSize: `${voiceVolume * 100}% 100%` }}
                    />
                    <span className="mixer-value">
                      {Math.round(voiceVolume * 100)}%
                    </span>
                  </div>
                  <div className="mixer-row">
                    <button
                      className={`mixer-toggle ${bgVolume === 0 ? "muted" : ""}`}
                      onClick={() => {
                        if (bgVolume === 0) {
                          setBgVolume(prevBgVolume.current || 0.3);
                        } else {
                          prevBgVolume.current = bgVolume;
                          setBgVolume(0);
                        }
                      }}
                      title={
                        bgVolume === 0 ? "Unmute background" : "Mute background"
                      }
                    >
                      {bgVolume === 0 ? (
                        <VolumeX size={16} />
                      ) : (
                        <Volume2 size={16} />
                      )}
                    </button>
                    <div className="mixer-label">
                      <span>Background</span>
                    </div>
                    <input
                      type="range"
                      className="mixer-slider bg-slider"
                      min="0"
                      max="1"
                      step="0.01"
                      value={bgVolume}
                      onChange={(e) => setBgVolume(parseFloat(e.target.value))}
                      style={{ backgroundSize: `${bgVolume * 100}% 100%` }}
                    />
                    <span className="mixer-value">
                      {Math.round(bgVolume * 100)}%
                    </span>
                  </div>
                </div>
              )}

              {/* TikTok Format Output */}
              {result.tiktokVideoUrl && (
                <div className="tiktok-output">
                  <h4>🎬 TikTok Format Ready!</h4>
                  <div className="tiktok-downloads">
                    <a
                      href={result.tiktokVideoUrl}
                      download
                      className="btn btn-accent"
                    >
                      <Download size={18} /> Download TikTok Video
                    </a>
                  </div>
                </div>
              )}

              {/* TikTok Metadata */}
              {result.metadata && (
                <div className="tiktok-metadata">
                  <h4>📋 TikTok Metadata</h4>
                  {result.metadata.hook && (
                    <div className="metadata-item">
                      <strong>🪝 Hook:</strong>
                      <p>"{result.metadata.hook}"</p>
                    </div>
                  )}
                  {result.metadata.caption && (
                    <div className="metadata-item">
                      <strong>📝 Caption:</strong>
                      <p className="caption-text">{result.metadata.caption}</p>
                      <button
                        className="btn-copy"
                        onClick={() =>
                          navigator.clipboard.writeText(result.metadata.caption)
                        }
                      >
                        Copy
                      </button>
                    </div>
                  )}
                  {result.metadata.hashtags && (
                    <div className="metadata-item">
                      <strong>#️⃣ Hashtags:</strong>
                      <p className="hashtags-text">
                        {result.metadata.hashtags.join(" ")}
                      </p>
                      <button
                        className="btn-copy"
                        onClick={() =>
                          navigator.clipboard.writeText(
                            result.metadata.hashtags.join(" "),
                          )
                        }
                      >
                        Copy
                      </button>
                    </div>
                  )}
                  {result.metadata.topText && (
                    <div className="metadata-item">
                      <strong>⬆️ Top Text:</strong>
                      <p>"{result.metadata.topText}"</p>
                    </div>
                  )}
                  {result.metadata.bottomText && (
                    <div className="metadata-item">
                      <strong>⬇️ Bottom Text:</strong>
                      <p>"{result.metadata.bottomText}"</p>
                    </div>
                  )}
                </div>
              )}

              {/* Cost Estimate */}
              <div className="cost-estimate">
                <p>
                  <strong>Estimated cost:</strong>{" "}
                  {flags.includes("lipsync")
                    ? "~$6"
                    : ttsProvider === "premium" || selectedTier === "immerser"
                      ? "~$0.50"
                      : ttsProvider === "clone" || selectedTier === "pro"
                        ? "~$0.40"
                        : "~$0.05"}{" "}
                  for 5 minutes
                </p>
              </div>

              {/* Reset button */}
              <div style={{ padding: "1rem 1.5rem" }}>
                <button
                  className="btn btn-secondary"
                  onClick={handleReset}
                  style={{ width: "100%" }}
                >
                  <RefreshCw size={18} />
                  Process Another Video
                </button>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="footer">
        <p>
          Powered by comprehensible input methodology. Inspired by{" "}
          <a
            href="https://dreamingspanish.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            Dreaming Spanish
          </a>{" "}
          &amp; Dr. Stephen Krashen.
        </p>
      </footer>
    </div>
  );
}

export default App;
