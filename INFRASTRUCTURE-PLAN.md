# 🏗️ Infrastructure Plan: Self-Hosting & User Management

**Goal:** Scale to 1000s of users without breaking the bank  
**Strategy:** Smart hybrid (APIs for MVP → Self-host for scale)

---

## 🤖 Part 1: Self-Hosting Models

### **Your Concern: "I don't have enough TTS with Replicate"**

**You're 100% RIGHT to worry about this.** Let's fix it.

---

## 💰 Cost Analysis (At Scale)

### **Current Setup (All APIs):**

**Per 5-minute video:**
- Demucs (Replicate): $0.07
- Whisper (Lemonfox): $0.01
- Gemini Translation: $0.00 (free tier)
- TTS (Lemonfox): $0.01-0.02
- **Total: ~$0.10 per video**

**At 1000 videos/month:**
- Cost: $100
- Revenue (if 100 paying users @ $9.99): $999
- **Margin: 90%** ✅

**At 10,000 videos/month:**
- Cost: $1,000
- Revenue (if 1000 paying users @ $9.99): $9,990
- **Margin: 90%** ✅

**Seems fine, right? BUT...**

---

### **The Hidden Problems:**

1. **Rate Limits**
   - Replicate: Limited concurrent requests
   - Lemonfox: API rate limits
   - **Bottleneck at scale**

2. **TTS is Your Biggest Cost**
   - $0.01 per video is AFTER speed optimization
   - Narrator mode: 3-5x more TTS = $0.05 per video
   - XTTS on Replicate: $0.05-0.10 per video
   - **At 10k videos/month: $500-1000 just on TTS**

3. **No Control**
   - Can't optimize
   - Can't guarantee uptime
   - Can't prioritize your jobs
   - **Bad user experience**

---

## 🎯 The Smart Hybrid Strategy

### **Phase 1: MVP (Week 1-3) - All APIs ✅**

**Keep everything as APIs for MVP:**
- ✅ Faster development (no infra to manage)
- ✅ Minimal upfront cost
- ✅ Test product-market fit first
- ✅ Learn what users actually use

**Why:** Don't optimize before you have users!

---

### **Phase 2: First 100 Users (Month 1-2) - Hybrid**

**Self-host the expensive/high-volume stuff:**

#### **1. TTS (Coqui XTTS v2) - SELF HOST** ⭐

**Why:**
- TTS is your biggest cost (50% of per-video cost)
- Used on EVERY video (can't avoid)
- Open-source models are GOOD (Coqui, StyleTTS2)

**How:**
```bash
# Option A: RunPod (Serverless GPU)
# Cost: $0.0004 per second of inference
# For 5-min video TTS: ~30s inference = $0.012
# Savings: 0% (same as Lemonfox!)

# Option B: Dedicated GPU (Modal, vast.ai)
# Cost: $0.50-1.00 per hour (24/7)
# At 1000 videos/month: $0.02 per video
# Savings: 50% vs Lemonfox

# Option C: Own hardware (RTX 4090)
# Cost: $2000 upfront + $50/month power
# At 1000 videos/month: $0.00 per video (after ROI)
# Savings: 100% after 4 months
```

**Recommendation: Modal/RunPod serverless**
- No upfront cost
- Auto-scaling
- Pay per use
- Easy deployment

---

#### **2. Whisper (Speech-to-Text) - SELF HOST**

**Why:**
- Used on every video
- Replicate has rate limits
- Open-source Whisper Large v3 is excellent

**How:**
```bash
# Modal or RunPod serverless
# Cost: $0.002 per minute of audio
# For 5-min video: $0.01
# Savings: Same as Lemonfox, but no rate limits!
```

**Recommendation: Self-host on Modal**
- faster-whisper library (2-3x faster)
- Batch processing
- No rate limits

---

#### **3. Demucs (Audio Separation) - KEEP AS API**

**Why:**
- Used once per video
- Only $0.07 (cheap enough)
- Replicate's GPU infrastructure is good
- Complex to self-host well

**Recommendation: Keep Replicate for now**

---

#### **4. Gemini (Translation) - KEEP AS API**

**Why:**
- Free tier is generous
- Self-hosting LLMs is expensive
- Gemini 2.0 Flash is fast and good
- Alternative: Llama 3.1 70B on Together.ai ($0.001/1K tokens)

**Recommendation: Keep Gemini (free tier) or Together.ai**

---

## 🚀 Self-Hosting Implementation Plan

### **Step 1: Setup Modal Account (30 minutes)**

Modal is PERFECT for your use case:
- Serverless GPU functions
- Pay per second
- Auto-scaling
- Easy deployment

```bash
# Install Modal
pip install modal

# Login
modal token new

# You're ready!
```

---

### **Step 2: Deploy TTS Function (2-3 hours)**

**File:** `server/modal_tts.py`

```python
import modal
import io
from pathlib import Path

# Define Modal app
app = modal.App("immersion-tts")

# Create image with dependencies
tts_image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "TTS==0.21.1",  # Coqui TTS
    "torch",
    "torchaudio",
)

@app.function(
    image=tts_image,
    gpu="T4",  # Cheapest GPU
    timeout=300,
)
def generate_tts(text: str, voice_model: str = "tts_models/es/css10/vits") -> bytes:
    """
    Generate Spanish TTS using Coqui TTS
    Returns: MP3 audio bytes
    """
    from TTS.api import TTS
    import tempfile
    
    # Initialize TTS model (cached after first run)
    tts = TTS(voice_model)
    
    # Generate to temp file
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tts.tts_to_file(text=text, file_path=f.name)
        
        # Read and return bytes
        with open(f.name, "rb") as audio_file:
            return audio_file.read()

@app.local_entrypoint()
def main():
    # Test the function
    audio = generate_tts.remote("Hola, ¿cómo estás? Esta es una prueba.")
    print(f"Generated {len(audio)} bytes of audio")
```

**Deploy:**
```bash
modal deploy server/modal_tts.py
```

**Call from Node.js:**
```javascript
// server/src/v2/tts-modal.js
const { spawn } = require('child_process');

async function generateTTS(text, voice = 'spanish') {
  return new Promise((resolve, reject) => {
    const modal = spawn('modal', ['run', 'modal_tts.py::generate_tts', '--text', text]);
    
    const chunks = [];
    modal.stdout.on('data', (data) => chunks.push(data));
    modal.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error('TTS failed'));
      }
    });
  });
}

module.exports = { generateTTS };
```

---

### **Step 3: Deploy Whisper Function (2-3 hours)**

**File:** `server/modal_whisper.py`

```python
import modal

app = modal.App("immersion-whisper")

whisper_image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "faster-whisper==1.0.0",
    "torch",
)

@app.function(
    image=whisper_image,
    gpu="T4",
    timeout=600,
)
def transcribe(audio_path: str, language: str = "en") -> dict:
    """
    Transcribe audio using faster-whisper
    Returns: { segments: [...], language: "en" }
    """
    from faster_whisper import WhisperModel
    
    # Load model (cached after first run)
    model = WhisperModel("large-v3", device="cuda", compute_type="float16")
    
    # Transcribe
    segments, info = model.transcribe(
        audio_path,
        language=language,
        beam_size=5,
        word_timestamps=True,
    )
    
    # Format results
    result = {
        "language": info.language,
        "segments": []
    }
    
    for segment in segments:
        result["segments"].append({
            "start": segment.start,
            "end": segment.end,
            "text": segment.text,
            "words": [{"word": w.word, "start": w.start, "end": w.end} for w in segment.words],
        })
    
    return result
```

---

### **Step 4: Fallback Strategy (Critical!)**

**Always have API fallback:**

```javascript
// server/src/v2/tts.js (updated)
async function generateTTS(text, options = {}) {
  const { useModal = true, voice = 'male' } = options;
  
  try {
    if (useModal && process.env.MODAL_ENABLED === 'true') {
      // Try Modal first
      return await modalTTS.generateTTS(text, voice);
    }
  } catch (modalError) {
    console.warn('Modal TTS failed, falling back to Lemonfox:', modalError.message);
  }
  
  // Fallback to Lemonfox API
  return await lemonfoxTTS.generateTTS(text, voice);
}
```

**Why fallback is critical:**
- Self-hosted can fail (GPU availability, etc)
- Don't let your entire pipeline fail
- Graceful degradation = happy users

---

## 💸 Cost Comparison (After Self-Hosting)

### **Current (All APIs):**
| Service | Per Video | 1K Videos | 10K Videos |
|---------|-----------|-----------|------------|
| Demucs | $0.07 | $70 | $700 |
| Whisper | $0.01 | $10 | $100 |
| Gemini | $0.00 | $0 | $0 |
| TTS | $0.02 | $20 | $200 |
| **Total** | **$0.10** | **$100** | **$1,000** |

### **Hybrid (TTS + Whisper self-hosted):**
| Service | Per Video | 1K Videos | 10K Videos |
|---------|-----------|-----------|------------|
| Demucs | $0.07 | $70 | $700 |
| Whisper (Modal) | $0.01 | $10 | $100 |
| Gemini | $0.00 | $0 | $0 |
| TTS (Modal) | $0.01 | $10 | $100 |
| **Total** | **$0.09** | **$90** | **$900** |
| **Savings** | 10% | 10% | 10% |

### **Full Self-Host (Dedicated GPU):**
| Service | Per Video | 1K Videos | 10K Videos |
|---------|-----------|-----------|------------|
| Demucs | $0.07 | $70 | $700 |
| Whisper | $0.00 | $0 | $0 |
| Gemini | $0.00 | $0 | $0 |
| TTS | $0.00 | $0 | $0 |
| GPU Server | $0.02 | $24 | $24 |
| **Total** | **$0.09** | **$94** | **$724** |
| **Savings** | 10% | 6% | 28% |

**Sweet spot:** Modal serverless for Phase 2, dedicated GPU for Phase 3 (1000+ users)

---

## 📋 Recommendation: Phased Approach

### **Phase 1: MVP (Now - Week 3)**
**Use ALL APIs**
- ✅ Lemonfox TTS
- ✅ Lemonfox Whisper
- ✅ Replicate Demucs
- ✅ Gemini Translation
- **Focus:** Ship fast, validate market

---

### **Phase 2: First 100 Paying Users (Week 4-8)**
**Self-host high-volume components**
- 🔄 Modal TTS (Coqui XTTS)
- 🔄 Modal Whisper (faster-whisper)
- ✅ Keep Replicate Demucs
- ✅ Keep Gemini
- **Focus:** Remove bottlenecks, improve margins

---

### **Phase 3: Scale (1000+ Users, Month 3+)**
**Dedicated infrastructure**
- 🔄 Own GPU server ($500/month for beefy machine)
- 🔄 TTS + Whisper on own hardware
- 🔄 Maybe self-host Demucs
- 🔄 Consider Llama 3.1 for translation
- **Focus:** Maximize margins, full control

---

## 🔐 Part 2: User Accounts & Payment

### **Goal: Seamless signup → payment → usage**

Your users should be able to:
1. Sign up in 30 seconds
2. Try 3 free videos
3. Upgrade with 1 click
4. Start processing immediately

---

## 🎯 Recommended Stack (Modern & Seamless)

### **Option A: Supabase + Stripe** ⭐ (Recommended)

**Why Supabase:**
- ✅ Auth built-in (email, magic link, social)
- ✅ PostgreSQL database included
- ✅ Real-time subscriptions
- ✅ Row-level security
- ✅ Free tier is generous
- ✅ Easy to use

**Why Stripe:**
- ✅ Industry standard
- ✅ Checkout is 1-click
- ✅ Handles subscriptions automatically
- ✅ Webhooks for status updates
- ✅ Customer portal (users manage billing)
- ✅ Great docs

**Cost:**
- Supabase: Free up to 50K MAU
- Stripe: 2.9% + $0.30 per transaction
- **Total: ~$0.40 per $9.99 subscription**

---

### **Option B: Clerk + Stripe** (If you want fancier auth)

**Why Clerk:**
- ✅ Beautiful pre-built UI
- ✅ Magic links, passkeys, social
- ✅ User management dashboard
- ✅ Better UX than Supabase auth
- ❌ More expensive ($25/month after 10K MAU)

**Use if:** You want the absolute best auth UX

---

### **Option C: NextAuth + Stripe** (If you want free)

**Why NextAuth:**
- ✅ Completely free
- ✅ Very flexible
- ❌ More setup required
- ❌ No built-in UI

**Use if:** You're on a tight budget

---

## 💳 Recommended: Supabase + Stripe

**Implementation Plan (Week 2):**

### **Day 1: Setup Supabase (2 hours)**

```bash
# 1. Create Supabase project (https://supabase.com)
# 2. Install client
npm install @supabase/supabase-js

# 3. Create users table
# Run in Supabase SQL editor:
```

```sql
-- Users table (Supabase auth.users is automatic)
create table user_profiles (
  id uuid references auth.users primary key,
  email text unique not null,
  subscription_tier text default 'free', -- 'free' | 'learner' | 'power'
  stripe_customer_id text,
  stripe_subscription_id text,
  videos_processed integer default 0,
  videos_limit integer default 3,
  created_at timestamp default now()
);

-- Jobs table
create table jobs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references user_profiles(id),
  status text default 'processing',
  url text,
  level text,
  mode text,
  outputs jsonb,
  result jsonb,
  created_at timestamp default now()
);

-- Enable row-level security
alter table user_profiles enable row level security;
alter table jobs enable row level security;

-- Policies: Users can only see their own data
create policy "Users can view own profile"
  on user_profiles for select
  using (auth.uid() = id);

create policy "Users can view own jobs"
  on jobs for select
  using (auth.uid() = user_id);
```

---

### **Day 2: Integrate Supabase Auth in Frontend (3 hours)**

**File:** `frontend/src/auth.js`

```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// Sign up with email
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

// Sign in with email
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

// Magic link (passwordless)
export async function signInWithMagicLink(email) {
  const { data, error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin,
    },
  });
  if (error) throw error;
  return data;
}

// Sign out
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Get current user
export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// Listen to auth changes
export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}

export { supabase };
```

**Add to App.jsx:**

```javascript
import { useEffect, useState } from 'react';
import { supabase, getUser, signInWithMagicLink } from './auth';

function App() {
  const [user, setUser] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  
  useEffect(() => {
    // Check if user is logged in
    getUser().then(setUser);
    
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null);
    });
    
    return () => subscription.unsubscribe();
  }, []);
  
  // Rest of your app...
}
```

---

### **Day 3: Setup Stripe (3 hours)**

```bash
# Install Stripe
npm install stripe @stripe/stripe-js
```

**Backend:** `server/stripe.js`

```javascript
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Create checkout session
async function createCheckoutSession(userId, priceId, userEmail) {
  const session = await stripe.checkout.sessions.create({
    customer_email: userEmail,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [
      {
        price: priceId, // Stripe price ID for $9.99/month
        quantity: 1,
      },
    ],
    success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/pricing`,
    metadata: {
      userId,
    },
  });
  
  return session;
}

// Handle webhook events
async function handleWebhook(event) {
  switch (event.type) {
    case 'checkout.session.completed':
      // User subscribed! Update their profile
      const session = event.data.object;
      await updateUserSubscription(
        session.metadata.userId,
        'learner', // or 'power'
        session.customer,
        session.subscription
      );
      break;
      
    case 'customer.subscription.deleted':
      // Subscription cancelled
      await updateUserSubscription(
        session.metadata.userId,
        'free'
      );
      break;
  }
}

module.exports = {
  createCheckoutSession,
  handleWebhook,
};
```

**Add routes:** `server/server.js`

```javascript
const stripe = require('./stripe');

// Create checkout
app.post('/api/create-checkout', async (req, res) => {
  const { userId, tier } = req.body;
  
  const priceId = tier === 'learner' 
    ? process.env.STRIPE_PRICE_LEARNER 
    : process.env.STRIPE_PRICE_POWER;
  
  const session = await stripe.createCheckoutSession(userId, priceId, user.email);
  res.json({ url: session.url });
});

// Stripe webhook
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  try {
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    
    await stripe.handleWebhook(event);
    res.json({ received: true });
  } catch (err) {
    res.status(400).send(`Webhook Error: ${err.message}`);
  }
});
```

---

### **Day 4: Integrate Payment in Frontend (2 hours)**

**File:** `frontend/src/components/Pricing.jsx`

```javascript
import { supabase } from '../auth';

function PricingCard({ tier, price, features, priceId }) {
  const handleUpgrade = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    
    // Call backend to create checkout
    const response = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: user.id,
        tier,
      }),
    });
    
    const { url } = await response.json();
    
    // Redirect to Stripe Checkout
    window.location.href = url;
  };
  
  return (
    <div className="pricing-card">
      <h3>{tier}</h3>
      <p className="price">${price}/month</p>
      <ul>
        {features.map(f => <li key={f}>{f}</li>)}
      </ul>
      <button onClick={handleUpgrade}>
        Upgrade Now
      </button>
    </div>
  );
}
```

---

## ✨ The Seamless User Experience

### **First-Time User Flow:**

```
1. Land on homepage
   ↓
2. Click "Try Free" → Enter email
   ↓
3. Check email → Click magic link
   ↓
4. Redirected back → Logged in!
   ↓
5. Process first video (1 of 3 free)
   ↓
6. Video ready! Download + transcript
   ↓
7. "❤️ this? Get 30/month for $9.99"
   ↓
8. Click upgrade → Stripe Checkout (1 click)
   ↓
9. Done! Start processing more videos
```

**Total time: 2 minutes from landing to first video** 🚀

---

## 📋 Implementation Timeline

### **Week 2: Auth + Payments**

**Day 8-9: Supabase Auth**
- [ ] Setup Supabase project
- [ ] Create database schema
- [ ] Integrate auth in frontend
- [ ] Add magic link signup

**Day 10-11: Stripe Integration**
- [ ] Setup Stripe products/prices
- [ ] Create checkout flow
- [ ] Add webhook handler
- [ ] Test subscription flow

**Day 12-13: Enforce Limits**
- [ ] Check user tier before processing
- [ ] Track videos processed
- [ ] Show usage in UI
- [ ] Add upgrade prompts

**Day 14: Testing**
- [ ] Test free → paid flow
- [ ] Test subscription cancellation
- [ ] Test webhook reliability
- [ ] Fix bugs

---

## 🎯 Summary & Recommendations

### **Self-Hosting:**
**Don't self-host for MVP!** Use APIs.

**Timeline:**
- Week 1-3 (MVP): All APIs
- Week 4-8 (100 users): Self-host TTS + Whisper on Modal
- Month 3+ (1000+ users): Dedicated GPU server

**Why:** Focus on product-market fit first, optimize later.

---

### **User Accounts:**
**Use Supabase + Stripe**

**Why:**
- Magic link auth (seamless, no passwords)
- Built-in database
- Stripe handles subscriptions
- Takes 2-3 days to implement
- Users can sign up and pay in < 2 minutes

---

## 🚀 Your Actual Next Steps

**This Week (MVP):**
1. ✅ Keep all APIs as-is
2. ✅ Focus on v2 API + frontend
3. ✅ Launch MVP with APIs

**Week 4-5 (Post-Launch):**
4. Setup Supabase auth
5. Integrate Stripe
6. Deploy to production

**Week 6-8 (After 100 Users):**
7. Deploy Modal TTS function
8. Deploy Modal Whisper function
9. Update pipeline to use Modal with API fallback

**Month 3+ (Scale):**
10. Evaluate dedicated GPU server
11. Migrate high-volume processing
12. Maximize margins

---

**Bottom Line:** APIs for MVP, hybrid for scale, full self-host at 1000+ users. Supabase + Stripe for seamless auth/payments. ✅
