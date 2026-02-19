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
  Headphones,
  Code,
  Wand2,
  Music,
  Heart,
  Plus,
  Maximize,
  Minimize,
} from "lucide-react";
import "./App.css";

const API_URL = "/api";

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
    value: "spleeter",
    label: "Spleeter",
    desc: "Fast/cheap separation — great for dev (136x cheaper)",
    icon: "🧪",
  },
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
// REMIX VOICE STYLES (kept for pipeline compatibility)
// ============================================

// ============================================
// MAIN APP COMPONENT
// ============================================

function App() {
  // Dev mode unlock: visit ?dev=immerse to unlock, persists in localStorage
  const [devUnlocked] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("dev") === "immerse") {
      localStorage.setItem("immerse-dev-unlocked", "true");
      window.history.replaceState({}, "", window.location.pathname);
      return true;
    }
    return localStorage.getItem("immerse-dev-unlocked") === "true";
  });

  // App mode: "remix" (voice remix) or "dev" (full control, hidden)
  const [appMode, setAppMode] = useState(() => {
    const saved = localStorage.getItem("immerse-app-mode");
    return saved === "dev" && devUnlocked ? "dev" : "remix";
  });


  // Helper function to get persisted state
  // Job state (isProcessing, jobId, progress, etc.) uses sessionStorage (per-tab)
  // so you can process multiple videos in parallel across tabs.
  // User preferences (level, mode, language, etc.) use localStorage (shared).
  const JOB_STATE_KEYS = ["isProcessing", "jobId", "progress", "currentStep", "processingStartedAt", "result"];
  const getPersistedState = (key, defaultValue) => {
    try {
      const storage = JOB_STATE_KEYS.includes(key) ? sessionStorage : localStorage;
      const item = storage.getItem(`immerse-${key}`);
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
  // Detect stale processing state (>30 min old = probably dead)
  const [isProcessing, setIsProcessing] = useState(() => {
    const processing = getPersistedState("isProcessing", false);
    if (processing) {
      const startedAt = getPersistedState("processingStartedAt", 0);
      const elapsed = Date.now() - startedAt;
      const MAX_AGE = 30 * 60 * 1000; // 30 minutes
      if (elapsed > MAX_AGE) {
        console.log(
          `Clearing stale processing state (${Math.round(elapsed / 60000)}min old)`,
        );
        sessionStorage.removeItem("immerse-isProcessing");
        sessionStorage.removeItem("immerse-jobId");
        sessionStorage.removeItem("immerse-progress");
        sessionStorage.removeItem("immerse-currentStep");
        sessionStorage.removeItem("immerse-processingStartedAt");
        return false;
      }
    }
    return processing;
  });
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPortraitVideo, setIsPortraitVideo] = useState(false);
  const remixPlayerRef = useRef(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
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

  // Remix mode state
  const [remixVoicePrompt, setRemixVoicePrompt] = useState(() =>
    getPersistedState("remixVoicePrompt", ""),
  );
  const [remixClone, setRemixClone] = useState(() =>
    getPersistedState("remixClone", false),
  );
  const [remixPremium, setRemixPremium] = useState(() =>
    getPersistedState("remixPremium", false),
  );
  const DEFAULT_VOICES = [
    { id: "preset_spanish_b1", name: "Spanish B1", prompt: "Spanish guy, B1 intermediate level", emoji: "🇪🇸", clone: false },
    { id: "preset_spanish", name: "Spanish", prompt: "Spanish speaker, native fluency", emoji: "🇪🇸", clone: false },
    { id: "preset_french", name: "French", prompt: "French speaker, native fluency", emoji: "🇫🇷", clone: false },
    { id: "preset_pirate", name: "Pirate", prompt: "Grizzled pirate captain with a thick West Country accent", emoji: "🏴‍☠️", clone: false },
    { id: "preset_british_doc", name: "British Documentary", prompt: "British documentary narrator, like David Attenborough", emoji: "🇬🇧", clone: false },
  ];
  const [savedVoices, setSavedVoices] = useState(() => {
    const persisted = getPersistedState("savedVoices", null);
    if (persisted && persisted.length > 0) return persisted;
    return DEFAULT_VOICES;
  });
  const [newVoicePrompt, setNewVoicePrompt] = useState("");
  const [newVoiceClone, setNewVoiceClone] = useState(false);
  const [remixVoiceSampleUrl, setRemixVoiceSampleUrl] = useState(null);
  const [remixExtractUrl, setRemixExtractUrl] = useState("");
  const [remixExtractFile, setRemixExtractFile] = useState(null);
  const [remixExtractSamples, setRemixExtractSamples] = useState([]);
  const [isRemixExtracting, setIsRemixExtracting] = useState(false);
  // Voice versions: [{id, name, audioUrl, voicePrompt, clone}]
  const [voiceVersions, setVoiceVersions] = useState([]);
  const [activeVoiceIdx, setActiveVoiceIdx] = useState(-1);
  // Track the latest job directory for caching re-remixes
  const [latestJobDir, setLatestJobDir] = useState(null);
  // Remix player toggles
  const [remixOriginalOn, setRemixOriginalOn] = useState(true);
  const [remixBgOn, setRemixBgOn] = useState(true);

  // Remix audio refs
  const originalVocalsRef = useRef(null);
  const voiceAudioRefs = useRef({});
  const remixBgRef = useRef(null);

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
    sessionStorage.setItem("immerse-isProcessing", JSON.stringify(isProcessing));
    if (isProcessing) {
      // Save timestamp so we can detect stale jobs on next load
      sessionStorage.setItem(
        "immerse-processingStartedAt",
        JSON.stringify(Date.now()),
      );
    }
  }, [isProcessing]);
  useEffect(() => {
    sessionStorage.setItem("immerse-jobId", JSON.stringify(jobId));
  }, [jobId]);
  useEffect(() => {
    sessionStorage.setItem("immerse-progress", JSON.stringify(progress));
  }, [progress]);
  useEffect(() => {
    sessionStorage.setItem("immerse-currentStep", JSON.stringify(currentStep));
  }, [currentStep]);
  useEffect(() => {
    sessionStorage.setItem("immerse-result", JSON.stringify(result));
  }, [result]);

  // When a remix result arrives, capture its voice audio as a version + cache jobDir
  useEffect(() => {
    if (result && (result.restyledVoiceUrl || result.voiceOnlyUrl)) {
      const audioUrl = result.restyledVoiceUrl || result.voiceOnlyUrl;

      // Track the latest job directory for caching re-remixes
      if (result.jobDir) {
        setLatestJobDir(result.jobDir);
      }

      setVoiceVersions((prev) => {
        if (prev.some((v) => v.audioUrl === audioUrl)) return prev;
        const label = remixVoicePrompt || "Default voice";
        const shortName =
          label.length > 22 ? label.substring(0, 22) + "…" : label;
        const updated = [
          ...prev,
          {
            id: Date.now().toString(),
            name: shortName,
            audioUrl,
            voicePrompt: remixVoicePrompt,
            clone: remixClone,
          },
        ];
        setActiveVoiceIdx(updated.length - 1);
        setRemixOriginalOn(false);
        return updated;
      });
    }
  }, [result]);

  // Persist remix state
  useEffect(() => {
    localStorage.setItem(
      "immerse-remixVoicePrompt",
      JSON.stringify(remixVoicePrompt),
    );
  }, [remixVoicePrompt]);
  useEffect(() => {
    localStorage.setItem("immerse-remixClone", JSON.stringify(remixClone));
  }, [remixClone]);
  useEffect(() => {
    localStorage.setItem("immerse-remixPremium", JSON.stringify(remixPremium));
  }, [remixPremium]);
  useEffect(() => {
    localStorage.setItem("immerse-savedVoices", JSON.stringify(savedVoices));
  }, [savedVoices]);

  // Sync audio elements: pause inactive, set volume on active
  useEffect(() => {
    if (originalVocalsRef.current) {
      originalVocalsRef.current.volume = remixOriginalOn ? 1 : 0;
      if (!remixOriginalOn) originalVocalsRef.current.pause();
    }
  }, [remixOriginalOn]);
  useEffect(() => {
    voiceVersions.forEach((v, idx) => {
      const el = voiceAudioRefs.current[v.id];
      if (!el) return;
      if (idx === activeVoiceIdx) {
        el.volume = 1;
      } else {
        el.volume = 0;
        el.pause();
      }
    });
  }, [activeVoiceIdx, voiceVersions]);
  useEffect(() => {
    if (remixBgRef.current) {
      if (remixBgOn) {
        remixBgRef.current.volume = 0.4;
      } else {
        remixBgRef.current.volume = 0;
        remixBgRef.current.pause();
      }
    }
  }, [remixBgOn]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  // Poll for job status - extracted so it can be called from resume + visibility change
  const startPolling = (targetJobId) => {
    // Clear any existing stale interval
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    console.log(`Starting/resuming poll for job ${targetJobId}`);

    // Do an immediate check first, then start interval
    const checkStatus = async () => {
      try {
        const statusResponse = await fetch(
          `${API_URL}/v2/status/${targetJobId}`,
        );
        if (!statusResponse.ok) {
          // Job not found on server (server restarted, job expired)
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          setError(
            "Job not found - server may have restarted. Please try again.",
          );
          setIsProcessing(false);
          return;
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
        setError("Connection lost. Check your network and try again.");
        setIsProcessing(false);
      }
    };

    // Immediate check
    checkStatus();
    // Then poll every 2s
    pollIntervalRef.current = setInterval(checkStatus, 2000);
  };

  // Resume polling if there was a job in progress (on mount)
  useEffect(() => {
    if (jobId && isProcessing) {
      startPolling(jobId);
    }
  }, []); // Only run once on mount

  // Re-check job status when tab regains focus (Safari kills timers in background)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && jobId && isProcessing) {
        console.log("Tab regained focus, re-checking job status...");
        startPolling(jobId);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [jobId, isProcessing]);

  // Sync playback speed across all media elements (dev + remix)
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackSpeed;
    if (audioRef.current) audioRef.current.playbackRate = playbackSpeed;
    if (voiceAudioRef.current)
      voiceAudioRef.current.playbackRate = playbackSpeed;
    if (bgAudioRef.current) bgAudioRef.current.playbackRate = playbackSpeed;
    // Remix audio refs
    if (originalVocalsRef.current) originalVocalsRef.current.playbackRate = playbackSpeed;
    if (remixBgRef.current) remixBgRef.current.playbackRate = playbackSpeed;
    if (voiceAudioRefs.current) {
      Object.values(voiceAudioRefs.current).forEach((el) => {
        if (el) el.playbackRate = playbackSpeed;
      });
    }
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
      startPolling(data.jobId);
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
    // Clean up remix audio refs
    if (originalVocalsRef.current) {
      originalVocalsRef.current.pause();
      originalVocalsRef.current.src = "";
    }
    Object.values(voiceAudioRefs.current).forEach((el) => {
      if (el) {
        el.pause();
        el.src = "";
      }
    });
    voiceAudioRefs.current = {};
    if (remixBgRef.current) {
      remixBgRef.current.pause();
      remixBgRef.current.src = "";
    }

    // Clear processing state
    setResult(null);
    setVoiceVersions([]);
    setActiveVoiceIdx(-1);
    setLatestJobDir(null);
    setJobId(null);
    setProgress(0);
    setCurrentStep("");
    setError(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setVideoDuration(0);
    setIsPortraitVideo(false);
    setVoiceVolume(0.85);
    setBgVolume(0.3);
    setIsProcessing(false);

    // Reset remix toggles
    setRemixOriginalOn(true);
    setRemixModifiedOn(false);
    setRemixBgOn(true);

    // Clear persisted processing state from sessionStorage
    sessionStorage.removeItem("immerse-result");
    sessionStorage.removeItem("immerse-jobId");
    sessionStorage.removeItem("immerse-progress");
    sessionStorage.removeItem("immerse-currentStep");
    sessionStorage.removeItem("immerse-isProcessing");
    sessionStorage.removeItem("immerse-processingStartedAt");
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


  // Extract voice samples for remix clone mode
  const handleRemixExtract = async () => {
    setIsRemixExtracting(true);
    setRemixExtractSamples([]);
    try {
      let response;
      if (remixExtractFile) {
        const formData = new FormData();
        formData.append("file", remixExtractFile);
        formData.append("mode", "auto");
        formData.append("samplesPerSpeaker", "2");
        response = await fetch(`${API_URL}/v2/extract-voice`, { method: "POST", body: formData });
      } else if (remixExtractUrl.trim()) {
        response = await fetch(`${API_URL}/v2/extract-voice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: remixExtractUrl.trim(), mode: "auto", samplesPerSpeaker: 2 }),
        });
      } else return;

      if (!response.ok) throw new Error("Extraction failed");
      const data = await response.json();
      setRemixExtractSamples(data.samples || []);
      if (data.samples?.length > 0) {
        setRemixVoiceSampleUrl(data.samples[0].url);
      }
    } catch (err) {
      setError(`Voice extraction failed: ${err.message}`);
    } finally {
      setIsRemixExtracting(false);
    }
  };

  // Remix submit handler — accepts optional overrides for re-remix flow
  const handleRemixSubmit = async (overrides = {}) => {
    const isReRemix = !!overrides.voicePrompt && !!result;

    setError(null);
    setIsProcessing(true);
    setProgress(0);
    setCurrentStep(isReRemix ? "Generating new voice..." : "Starting remix...");
    setJobId(null);

    // On re-remix, keep result so the player stays visible
    if (!isReRemix) {
      setResult(null);
      setVoiceVersions([]);
      setActiveVoiceIdx(-1);
    }

    const activeVoicePrompt = overrides.voicePrompt ?? (remixVoicePrompt || null);
    const activeClone = overrides.clone ?? remixClone;

    // For re-remix, pass the previous job directory to skip ingest/split/transcribe
    const cacheDir = isReRemix ? latestJobDir : null;

    try {
      let response;

      const activeSampleUrl = activeClone ? remixVoiceSampleUrl : null;

      if (inputType === "file" && uploadedFile) {
        const formData = new FormData();
        formData.append("file", uploadedFile);
        formData.append("style", "custom");
        if (activeVoicePrompt)
          formData.append("voicePrompt", activeVoicePrompt);
        formData.append("clone", activeClone.toString());
        formData.append("premium", remixPremium.toString());
        if (cacheDir) formData.append("fromJobDir", cacheDir);
        if (activeSampleUrl) formData.append("voiceSampleUrl", activeSampleUrl);

        response = await fetch(`${API_URL}/v2/remix-file`, {
          method: "POST",
          body: formData,
        });
      } else {
        if (!url) throw new Error("Please enter a URL");

        response = await fetch(`${API_URL}/v2/remix`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url,
            style: "custom",
            voicePrompt: activeVoicePrompt,
            clone: activeClone,
            premium: remixPremium,
            fromJobDir: cacheDir,
            voiceSampleUrl: activeSampleUrl,
          }),
        });
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Remix failed");
      }

      const data = await response.json();
      setJobId(data.jobId);

      // Start polling for status
      startPolling(data.jobId);
    } catch (err) {
      setError(err.message);
      setIsProcessing(false);
    }
  };

  // Remix player controls — only play/pause active audio tracks
  const getActiveAudioEls = () => {
    const els = [];
    if (remixOriginalOn && originalVocalsRef.current)
      els.push(originalVocalsRef.current);
    if (activeVoiceIdx >= 0 && voiceVersions[activeVoiceIdx]) {
      const el = voiceAudioRefs.current[voiceVersions[activeVoiceIdx].id];
      if (el) els.push(el);
    }
    if (remixBgOn && remixBgRef.current) els.push(remixBgRef.current);
    return els;
  };

  const getAllAudioEls = () => {
    const els = [];
    if (originalVocalsRef.current) els.push(originalVocalsRef.current);
    Object.values(voiceAudioRefs.current).forEach((el) => {
      if (el) els.push(el);
    });
    if (remixBgRef.current) els.push(remixBgRef.current);
    return els;
  };

  const toggleRemixPlay = () => {
    const media = videoRef.current;

    if (isPlaying) {
      media?.pause();
      getAllAudioEls().forEach((a) => a.pause());
    } else {
      media?.play();
      getActiveAudioEls().forEach((a) => a.play());
    }
    setIsPlaying(!isPlaying);
  };

  // Sync active audio when toggling — pause/play the right tracks
  const syncActiveAudio = (newOriginalOn, newVoiceIdx) => {
    // Pause everything first
    if (originalVocalsRef.current) originalVocalsRef.current.pause();
    Object.values(voiceAudioRefs.current).forEach((el) => {
      if (el) el.pause();
    });

    // If playing, start the newly active track
    if (isPlaying) {
      if (newOriginalOn && originalVocalsRef.current) {
        originalVocalsRef.current.currentTime =
          videoRef.current?.currentTime || 0;
        originalVocalsRef.current.play();
      }
      if (newVoiceIdx >= 0 && voiceVersions[newVoiceIdx]) {
        const el = voiceAudioRefs.current[voiceVersions[newVoiceIdx].id];
        if (el) {
          el.currentTime = videoRef.current?.currentTime || 0;
          el.play();
        }
      }
    }
  };

  // Scrubbing: mousedown starts scrub, mousemove seeks in real-time, mouseup commits
  const scrubTimelineRef = useRef(null);
  const wasPlayingBeforeScrub = useRef(false);

  const getSeekTime = (e) => {
    const bar = scrubTimelineRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return percent * videoDuration;
  };

  const seekToTime = (newTime) => {
    if (videoRef.current) videoRef.current.currentTime = newTime;
    getActiveAudioEls().forEach((a) => { a.currentTime = newTime; });
    setCurrentTime(newTime);
  };

  const handleScrubStart = (e) => {
    e.preventDefault();
    setIsScrubbing(true);
    wasPlayingBeforeScrub.current = isPlaying;
    // Pause during scrub for snappy feedback
    if (isPlaying) {
      videoRef.current?.pause();
      getAllAudioEls().forEach((a) => a.pause());
    }
    seekToTime(getSeekTime(e));
  };

  useEffect(() => {
    if (!isScrubbing) return;
    const handleMove = (e) => seekToTime(getSeekTime(e));
    const handleUp = () => {
      setIsScrubbing(false);
      if (wasPlayingBeforeScrub.current) {
        videoRef.current?.play();
        getActiveAudioEls().forEach((a) => a.play());
      }
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("touchmove", (e) => handleMove(e.touches[0]));
    window.addEventListener("touchend", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isScrubbing]);

  // Simple click seek (fallback for non-drag)
  const handleRemixSeek = (e) => seekToTime(getSeekTime(e));

  // Fullscreen toggle — uses native API where available, CSS fallback for iOS
  const toggleFullscreen = () => {
    const el = remixPlayerRef.current;
    if (!el) return;

    if (isFullscreen) {
      // Exit fullscreen
      if (document.fullscreenElement) {
        document.exitFullscreen?.() || document.webkitExitFullscreen?.();
      } else if (document.webkitFullscreenElement) {
        document.webkitExitFullscreen?.();
      }
      setIsFullscreen(false);
      document.body.style.overflow = "";
    } else {
      // Enter fullscreen — try native API first, CSS fallback for mobile/iOS
      if (el.requestFullscreen) {
        el.requestFullscreen().catch(() => {
          setIsFullscreen(true);
          document.body.style.overflow = "hidden";
        });
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      } else {
        setIsFullscreen(true);
        document.body.style.overflow = "hidden";
      }
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      const isNativeFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      setIsFullscreen(isNativeFs);
      if (!isNativeFs) document.body.style.overflow = "";
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    document.addEventListener("webkitfullscreenchange", handleFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFsChange);
      document.removeEventListener("webkitfullscreenchange", handleFsChange);
    };
  }, []);

  // Toggle original voice (radio: turns off voice versions)
  const handleToggleOriginal = () => {
    if (!remixOriginalOn) {
      setRemixOriginalOn(true);
      setActiveVoiceIdx(-1);
      syncActiveAudio(true, -1);
    }
    // Can't turn off original if it's the active one — must select something else
  };

  // Select a voice version (radio: turns off original and other versions)
  const handleSelectVoiceVersion = (idx) => {
    if (activeVoiceIdx !== idx) {
      setActiveVoiceIdx(idx);
      setRemixOriginalOn(false);
      syncActiveAudio(false, idx);
    }
    // Can't deselect — must pick original or another version
  };

  // Check if result is a remix result
  const isRemixResult = result?.type === "remix" || result?.originalVocalsUrl;

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
        {devUnlocked && (
          <div className="mode-toggle">
            <button
              className={`mode-btn ${appMode === "remix" ? "active" : ""}`}
              onClick={() => setAppMode("remix")}
              title="Voice remix"
            >
              <Wand2 size={16} />
              Remix
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
        )}
      </header>

      <main className="main">
        {/* ============================================
            REMIX MODE - Voice Restyling Interface
            ============================================ */}
        {appMode === "remix" && !result && !isProcessing && (
          <>
            {/* Hero */}
            <section className="hero">
              <h1>
                <span>Remix</span> any voice
              </h1>
              <p>Upload a video, describe the vibe, and hear the magic.</p>
            </section>

            <div className="remix-card">
              {/* Input Section */}
              <div className="remix-section">
                <h3 className="remix-section-title">
                  <Film size={18} />
                  Input
                </h3>

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
              </div>

              {/* Saved Voices */}
              {savedVoices.length > 0 && (
                <div className="remix-section">
                  <h3 className="remix-section-title">
                    <Heart size={18} />
                    Saved Voices
                  </h3>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "0.5rem",
                    }}
                  >
                    {savedVoices.map((v) => (
                      <div
                        key={v.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.25rem",
                        }}
                      >
                        <button
                          className={`remix-style-card ${remixVoicePrompt === v.prompt ? "selected" : ""}`}
                          style={{
                            padding: "0.5rem 0.75rem",
                            flexDirection: "row",
                            gap: "0.4rem",
                            minWidth: "auto",
                          }}
                          onClick={() => {
                            setRemixVoicePrompt(v.prompt);
                            setRemixClone(v.clone || false);
                          }}
                        >
                          <span style={{ fontSize: "1rem" }}>
                            {v.emoji || "🎙️"}
                          </span>
                          <span className="remix-style-name">{v.name}</span>
                        </button>
                        <button
                          style={{
                            padding: "0.25rem",
                            color: "var(--text-muted)",
                            opacity: 0.5,
                            transition: "opacity 0.2s",
                          }}
                          onClick={() =>
                            setSavedVoices((prev) =>
                              prev.filter((s) => s.id !== v.id),
                            )
                          }
                          onMouseEnter={(e) => (e.target.style.opacity = 1)}
                          onMouseLeave={(e) => (e.target.style.opacity = 0.5)}
                          title="Remove"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Voice Prompt */}
              <div className="remix-section">
                <h3 className="remix-section-title">
                  <Mic size={18} />
                  Describe the Voice
                </h3>

                <textarea
                  className="textarea"
                  placeholder='Describe anything — voice, language, persona. e.g. "Spanish guy, B1 level" or "Pirate captain" or "Deep Batman voice translating to French"'
                  value={remixVoicePrompt}
                  onChange={(e) => setRemixVoicePrompt(e.target.value)}
                  rows={2}
                  style={{ minHeight: "60px" }}
                />

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    marginTop: "0.75rem",
                  }}
                >
                  <label className="remix-toggle-option" style={{ flex: 1 }}>
                    <input
                      type="checkbox"
                      checked={remixClone}
                      onChange={(e) => setRemixClone(e.target.checked)}
                    />
                    <div className="remix-toggle-info">
                      <span className="remix-toggle-label">Voice Clone</span>
                      <span className="remix-toggle-desc">
                        Clone the original speaker's voice
                      </span>
                    </div>
                  </label>

                  {remixVoicePrompt.trim() && (
                    <button
                      className="btn-icon"
                      title="Save this voice"
                      style={{
                        border: "1px solid var(--border-subtle)",
                        flexShrink: 0,
                      }}
                      onClick={() => {
                        const prompt = remixVoicePrompt.trim();
                        if (
                          !prompt ||
                          savedVoices.some((v) => v.prompt === prompt)
                        )
                          return;
                        const words = prompt.split(/\s+/).slice(0, 4);
                        const name = words
                          .map(
                            (w) =>
                              w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
                          )
                          .join(" ");
                        const langEmojis = {
                          spanish: "🇪🇸",
                          french: "🇫🇷",
                          german: "🇩🇪",
                          japanese: "🇯🇵",
                          chinese: "🇨🇳",
                          korean: "🇰🇷",
                          portuguese: "🇧🇷",
                          italian: "🇮🇹",
                          russian: "🇷🇺",
                        };
                        const lower = prompt.toLowerCase();
                        const emoji =
                          Object.entries(langEmojis).find(([k]) =>
                            lower.includes(k),
                          )?.[1] || "🎙️";
                        setSavedVoices((prev) => [
                          ...prev,
                          {
                            id: Date.now().toString(),
                            name,
                            prompt,
                            emoji,
                            clone: remixClone,
                          },
                        ]);
                      }}
                    >
                      <Heart size={18} />
                    </button>
                  )}
                </div>

                {/* Voice Extraction — shown when clone is on */}
                {remixClone && (
                  <div style={{ marginTop: "0.75rem", padding: "0.75rem", background: "var(--bg-elevated)", borderRadius: "var(--radius-lg)", border: "1px solid var(--border-subtle)" }}>
                    <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                      Optionally extract a voice from another video to clone:
                    </p>
                    <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                      <input
                        type="text"
                        className="input no-icon"
                        placeholder="Paste YouTube/TikTok URL with voice to clone"
                        value={remixExtractUrl}
                        onChange={(e) => setRemixExtractUrl(e.target.value)}
                        style={{ flex: 1, fontSize: "0.85rem" }}
                      />
                      <button
                        className="btn btn-secondary"
                        style={{ padding: "0.5rem 0.75rem", fontSize: "0.8rem", whiteSpace: "nowrap" }}
                        disabled={isRemixExtracting || !remixExtractUrl.trim()}
                        onClick={handleRemixExtract}
                      >
                        {isRemixExtracting ? "Extracting..." : "Extract"}
                      </button>
                    </div>
                    {remixExtractSamples.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                        {remixExtractSamples.map((s) => (
                          <button
                            key={s.id}
                            className={`remix-style-card ${remixVoiceSampleUrl === s.url ? "selected" : ""}`}
                            style={{ padding: "0.4rem 0.6rem", flexDirection: "row", gap: "0.3rem", minWidth: "auto", fontSize: "0.8rem" }}
                            onClick={() => setRemixVoiceSampleUrl(s.url)}
                          >
                            <Mic size={14} />
                            <span>{s.speaker || s.id}</span>
                            <span style={{ fontSize: "0.7rem", opacity: 0.6 }}>{s.duration ? `${s.duration.toFixed(1)}s` : ""}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {remixVoiceSampleUrl && (
                      <p style={{ fontSize: "0.75rem", color: "var(--accent)", marginTop: "0.4rem" }}>
                        Voice sample selected — will clone this voice
                      </p>
                    )}
                    {!remixVoiceSampleUrl && !remixExtractSamples.length && (
                      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", opacity: 0.6 }}>
                        No voice selected — will clone from the input video
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Submit */}
              <button
                className="btn btn-primary remix-submit-btn"
                onClick={handleRemixSubmit}
                disabled={
                  isProcessing ||
                  (inputType === "url" && !url) ||
                  (inputType === "file" && !uploadedFile)
                }
              >
                <Wand2 size={20} />
                Remix Voice
              </button>

              {error && (
                <div className="error-message">
                  <AlertCircle size={20} />
                  {error}
                </div>
              )}
            </div>
          </>
        )}

        {/* Remix Progress — full card for initial, compact for re-remix */}
        {appMode === "remix" && isProcessing && voiceVersions.length === 0 && (
          <div className="user-progress-card">
            <div className="user-progress-header">
              <div className="user-progress-icon">
                <span className="spinner large" />
              </div>
              <h3>Remixing your video...</h3>
              <p className="user-progress-step">{currentStep}</p>
            </div>
            <div className="progress-bar large">
              <div
                className="progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="user-progress-percent">{progress}%</div>
            <button
              className="btn btn-secondary progress-cancel-btn"
              onClick={handleReset}
            >
              <X size={16} />
              Cancel
            </button>
          </div>
        )}


        {/* Remix Result Player */}
        {appMode === "remix" && result && isRemixResult && (
          <section className="player-section">
            <div className={`player-card ${isFullscreen ? "fullscreen" : ""}`} ref={remixPlayerRef}>
              <div className="player-header">
                <div className="player-title">
                  <h3>Your Remixed Video</h3>
                  <span className="player-badge">
                    🎨 Remixed
                  </span>
                </div>
                <div className="player-actions">
                  {result.videoUrl && (
                    <a
                      href={result.videoUrl}
                      download
                      className="btn-icon"
                      title="Download Video"
                    >
                      <Film size={20} />
                    </a>
                  )}
                  {result.audioUrl && (
                    <a
                      href={result.audioUrl}
                      download
                      className="btn-icon"
                      title="Download Mixed Audio"
                    >
                      <Download size={20} />
                    </a>
                  )}
                  <button
                    className="btn-icon"
                    onClick={toggleFullscreen}
                    title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
                  >
                    {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
                  </button>
                </div>
              </div>

              {/* Video Player (muted - audio comes from separate tracks) */}
              {result.videoUrl && (
                <div className={`video-container ${isPortraitVideo ? "portrait" : ""}`}>
                  <video
                    ref={videoRef}
                    src={result.videoUrl}
                    onTimeUpdate={() =>
                      setCurrentTime(videoRef.current?.currentTime || 0)
                    }
                    onLoadedMetadata={() => {
                      const v = videoRef.current;
                      if (v) {
                        setVideoDuration(v.duration || 0);
                        setIsPortraitVideo(v.videoHeight > v.videoWidth);
                      }
                    }}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    muted
                    playsInline
                  />
                </div>
              )}

              {/* Hidden audio elements for the 3 tracks */}
              {result.originalVocalsUrl && (
                <audio
                  ref={originalVocalsRef}
                  src={result.originalVocalsUrl}
                  preload="auto"
                  onLoadedMetadata={() => {
                    if (originalVocalsRef.current) {
                      originalVocalsRef.current.volume = remixOriginalOn
                        ? 1
                        : 0;
                      if (!result.videoUrl) {
                        setVideoDuration(
                          originalVocalsRef.current.duration || 0,
                        );
                      }
                    }
                  }}
                  onTimeUpdate={() => {
                    if (!result.videoUrl)
                      setCurrentTime(
                        originalVocalsRef.current?.currentTime || 0,
                      );
                  }}
                  onPlay={() => {
                    if (!result.videoUrl) setIsPlaying(true);
                  }}
                  onPause={() => {
                    if (!result.videoUrl) setIsPlaying(false);
                  }}
                />
              )}
              {/* Voice version audio elements */}
              {voiceVersions.map((v, idx) => (
                <audio
                  key={v.id}
                  ref={(el) => {
                    voiceAudioRefs.current[v.id] = el;
                  }}
                  src={v.audioUrl}
                  preload="auto"
                  onLoadedMetadata={() => {
                    const el = voiceAudioRefs.current[v.id];
                    if (el) el.volume = idx === activeVoiceIdx ? 1 : 0;
                  }}
                />
              ))}
              {result.backgroundUrl && (
                <audio
                  ref={remixBgRef}
                  src={result.backgroundUrl}
                  preload="auto"
                  onLoadedMetadata={() => {
                    if (remixBgRef.current) {
                      remixBgRef.current.volume = remixBgOn ? 0.4 : 0;
                    }
                  }}
                />
              )}

              {/* Player Controls */}
              <div className="player-controls">
                <button className="play-btn" onClick={toggleRemixPlay}>
                  {isPlaying ? <Pause size={24} /> : <Play size={24} />}
                </button>
                <div className="timeline">
                  <div
                    className={`timeline-bar ${isScrubbing ? "scrubbing" : ""}`}
                    ref={scrubTimelineRef}
                    onMouseDown={handleScrubStart}
                    onTouchStart={(e) => { e.preventDefault(); handleScrubStart(e.touches[0]); }}
                    onClick={handleRemixSeek}
                  >
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
              </div>
              {/* Speed Control */}
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

              {/* Toggle Switches */}
              <div className="remix-toggles">
                <div className="remix-toggle-row">
                  <button
                    className={`remix-switch ${remixOriginalOn ? "on" : "off"}`}
                    onClick={handleToggleOriginal}
                  >
                    <div className="remix-switch-track">
                      <div className="remix-switch-thumb" />
                    </div>
                  </button>
                  <div className="remix-toggle-label-group">
                    <Mic size={16} />
                    <span>Original</span>
                  </div>
                </div>

                {voiceVersions.map((v, idx) => (
                  <div className="remix-toggle-row" key={v.id}>
                    <button
                      className={`remix-switch ${activeVoiceIdx === idx ? "on" : "off"}`}
                      onClick={() => handleSelectVoiceVersion(idx)}
                    >
                      <div className="remix-switch-track">
                        <div className="remix-switch-thumb" />
                      </div>
                    </button>
                    <div className="remix-toggle-label-group">
                      <Wand2 size={16} />
                      <span>{v.name}</span>
                    </div>
                  </div>
                ))}

                {isProcessing && (
                  <div
                    className="remix-toggle-row"
                    style={{ opacity: 0.5 }}
                  >
                    <div style={{ width: 40, display: "flex", justifyContent: "center" }}>
                      <span className="spinner" />
                    </div>
                    <div className="remix-toggle-label-group">
                      <Wand2 size={16} />
                      <span style={{ fontStyle: "italic" }}>Loading…</span>
                    </div>
                  </div>
                )}

                <div className="remix-toggle-row">
                  <button
                    className={`remix-switch ${remixBgOn ? "on" : "off"}`}
                    onClick={() => setRemixBgOn(!remixBgOn)}
                  >
                    <div className="remix-switch-track">
                      <div className="remix-switch-thumb" />
                    </div>
                  </button>
                  <div className="remix-toggle-label-group">
                    <Music size={16} />
                    <span>Background</span>
                  </div>
                </div>
              </div>

              {/* Try Another Voice */}
              <div
                style={{
                  padding: "1.25rem 1.5rem",
                  borderTop: "1px solid var(--border-subtle)",
                }}
              >
                <h4
                  style={{
                    fontSize: "0.9rem",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    marginBottom: "0.75rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <Plus size={16} />
                  Add Voice
                </h4>

                {savedVoices.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "0.5rem",
                      marginBottom: "0.75rem",
                    }}
                  >
                    {savedVoices.map((v) => (
                      <button
                        key={v.id}
                        className="remix-style-card"
                        disabled={isProcessing}
                        style={{
                          padding: "0.4rem 0.75rem",
                          flexDirection: "row",
                          gap: "0.35rem",
                          minWidth: "auto",
                          fontSize: "0.8rem",
                          opacity: isProcessing ? 0.5 : 1,
                        }}
                        onClick={() => {
                          setRemixVoicePrompt(v.prompt);
                          setRemixClone(v.clone || false);
                          handleRemixSubmit({
                            voicePrompt: v.prompt,
                            clone: v.clone || false,
                          });
                        }}
                      >
                        <span>{v.emoji || "🎙️"}</span>
                        <span className="remix-style-name">{v.name}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    type="text"
                    className="input no-icon"
                    placeholder='e.g. "French woman, B2"'
                    value={newVoicePrompt}
                    onChange={(e) => setNewVoicePrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        newVoicePrompt.trim() &&
                        !isProcessing
                      ) {
                        const prompt = newVoicePrompt.trim();
                        setRemixVoicePrompt(prompt);
                        setRemixClone(newVoiceClone);
                        setNewVoicePrompt("");
                        handleRemixSubmit({
                          voicePrompt: prompt,
                          clone: newVoiceClone,
                        });
                      }
                    }}
                    style={{ flex: 1 }}
                    disabled={isProcessing}
                  />
                  <button
                    className="btn btn-primary"
                    style={{ padding: "0.75rem 1.25rem", width: "auto" }}
                    disabled={!newVoicePrompt.trim() || isProcessing}
                    onClick={() => {
                      const prompt = newVoicePrompt.trim();
                      if (!prompt) return;
                      // Auto-save this voice
                      if (!savedVoices.some((v) => v.prompt === prompt)) {
                        const words = prompt.split(/\s+/).slice(0, 4);
                        const name = words
                          .map(
                            (w) =>
                              w.charAt(0).toUpperCase() +
                              w.slice(1).toLowerCase(),
                          )
                          .join(" ");
                        const langEmojis = {
                          spanish: "🇪🇸",
                          french: "🇫🇷",
                          german: "🇩🇪",
                          japanese: "🇯🇵",
                          chinese: "🇨🇳",
                          korean: "🇰🇷",
                          portuguese: "🇧🇷",
                          italian: "🇮🇹",
                          russian: "🇷🇺",
                        };
                        const lower = prompt.toLowerCase();
                        const emoji =
                          Object.entries(langEmojis).find(([k]) =>
                            lower.includes(k),
                          )?.[1] || "🎙️";
                        setSavedVoices((prev) => [
                          ...prev,
                          {
                            id: Date.now().toString(),
                            name,
                            prompt,
                            emoji,
                            clone: newVoiceClone,
                          },
                        ]);
                      }
                      setRemixVoicePrompt(prompt);
                      setRemixClone(newVoiceClone);
                      setNewVoicePrompt("");
                      handleRemixSubmit({
                        voicePrompt: prompt,
                        clone: newVoiceClone,
                      });
                    }}
                  >
                    <Wand2 size={16} />
                    Go
                  </button>
                </div>

                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    marginTop: "0.5rem",
                    fontSize: "0.8rem",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={newVoiceClone}
                    onChange={(e) => setNewVoiceClone(e.target.checked)}
                  />
                  Clone original voice
                </label>
              </div>

              {/* Reset */}
              <div style={{ padding: "0.75rem 1.5rem 1.25rem" }}>
                <button
                  className="btn btn-secondary"
                  onClick={handleReset}
                  style={{ width: "100%", opacity: 0.7 }}
                >
                  <RefreshCw size={18} />
                  New Video
                </button>
              </div>
            </div>
          </section>
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
                  <button
                    className="btn btn-secondary progress-cancel-btn"
                    onClick={handleReset}
                    style={{ marginTop: "0.75rem" }}
                  >
                    <X size={16} />
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        )}


        {/* Results Section (standard - not remix) */}
        {result && !isRemixResult && (
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
                <div className={`video-container ${isPortraitVideo ? "portrait" : ""}`}>
                  <video
                    ref={videoRef}
                    src={result.videoUrl}
                    onTimeUpdate={() =>
                      setCurrentTime(videoRef.current?.currentTime || 0)
                    }
                    onLoadedMetadata={() => {
                      const v = videoRef.current;
                      if (v) {
                        setVideoDuration(v.duration || 0);
                        setIsPortraitVideo(v.videoHeight > v.videoWidth);
                      }
                    }}
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
                    : ttsProvider === "premium"
                      ? "~$0.50"
                      : ttsProvider === "clone"
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

    </div>
  );
}

export default App;
