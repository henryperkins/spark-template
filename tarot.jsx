import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Sparkles, RotateCcw, Moon, Sun, Star } from 'lucide-react';

const MAJOR_ARCANA = [
  { name: 'The Fool', number: 0, upright: 'New beginnings, innocence, spontaneity, free spirit', reversed: 'Recklessness, taken advantage of, inconsideration' },
  { name: 'The Magician', number: 1, upright: 'Manifestation, resourcefulness, power, inspired action', reversed: 'Manipulation, poor planning, untapped talents' },
  { name: 'The High Priestess', number: 2, upright: 'Intuition, sacred knowledge, divine feminine, subconscious', reversed: 'Secrets, disconnected from intuition, withdrawal' },
  { name: 'The Empress', number: 3, upright: 'Femininity, beauty, nature, nurturing, abundance', reversed: 'Creative block, dependence on others' },
  { name: 'The Emperor', number: 4, upright: 'Authority, establishment, structure, father figure', reversed: 'Domination, excessive control, lack of discipline' },
  { name: 'The Hierophant', number: 5, upright: 'Spiritual wisdom, tradition, conformity, institutions', reversed: 'Personal beliefs, freedom, challenging the status quo' },
  { name: 'The Lovers', number: 6, upright: 'Love, harmony, relationships, values alignment, choices', reversed: 'Self-love, disharmony, imbalance, misalignment' },
  { name: 'The Chariot', number: 7, upright: 'Control, willpower, success, action, determination', reversed: 'Self-discipline, opposition, lack of direction' },
  { name: 'Strength', number: 8, upright: 'Strength, courage, persuasion, influence, compassion', reversed: 'Inner strength, self-doubt, low energy, raw emotion' },
  { name: 'The Hermit', number: 9, upright: 'Soul-searching, introspection, inner guidance, solitude', reversed: 'Isolation, loneliness, withdrawal' },
  { name: 'Wheel of Fortune', number: 10, upright: 'Good luck, karma, life cycles, destiny, turning point', reversed: 'Bad luck, resistance to change, breaking cycles' },
  { name: 'Justice', number: 11, upright: 'Justice, fairness, truth, cause and effect, law', reversed: 'Unfairness, lack of accountability, dishonesty' },
  { name: 'The Hanged Man', number: 12, upright: 'Pause, surrender, letting go, new perspectives', reversed: 'Delays, resistance, stalling, indecision' },
  { name: 'Death', number: 13, upright: 'Endings, change, transformation, transition', reversed: 'Resistance to change, personal transformation, inner purging' },
  { name: 'Temperance', number: 14, upright: 'Balance, moderation, patience, purpose', reversed: 'Imbalance, excess, self-healing, re-alignment' },
  { name: 'The Devil', number: 15, upright: 'Shadow self, attachment, addiction, restriction, sexuality', reversed: 'Releasing limiting beliefs, exploring dark thoughts, detachment' },
  { name: 'The Tower', number: 16, upright: 'Sudden change, upheaval, chaos, revelation, awakening', reversed: 'Personal transformation, fear of change, averting disaster' },
  { name: 'The Star', number: 17, upright: 'Hope, faith, purpose, renewal, spirituality', reversed: 'Lack of faith, despair, self-trust, disconnection' },
  { name: 'The Moon', number: 18, upright: 'Illusion, fear, anxiety, subconscious, intuition', reversed: 'Release of fear, repressed emotion, inner confusion' },
  { name: 'The Sun', number: 19, upright: 'Positivity, fun, warmth, success, vitality', reversed: 'Inner child, feeling down, overly optimistic' },
  { name: 'Judgement', number: 20, upright: 'Judgement, rebirth, inner calling, absolution', reversed: 'Self-doubt, inner critic, ignoring the call' },
  { name: 'The World', number: 21, upright: 'Completion, accomplishment, travel, achievement', reversed: 'Seeking closure, shortcuts, delays' }
];

const SPREADS = {
  single: { name: 'Single Card', positions: ['Your Message'], count: 1 },
  threeCard: { name: 'Past-Present-Future', positions: ['Past', 'Present', 'Future'], count: 3 },
  celtic: {
    name: 'Celtic Cross',
    positions: [
      'Present',
      'Challenge',
      'Past',
      'Future',
      'Above',
      'Below',
      'Advice',
      'External',
      'Hopes/Fears',
      'Outcome'
    ],
    count: 10
  },
  relationship: { name: 'Relationship', positions: ['You', 'Them', 'Connection'], count: 3 },
  decision: { name: 'Decision Making', positions: ['Situation', 'Option A', 'Option B', 'Best Path'], count: 4 }
};

const EXAMPLE_QUESTIONS = [
  'What should I focus on this week?',
  'How can I navigate this relationship?',
  'What energy do I need right now?',
  'What lesson am I meant to learn?',
  'How can I move forward with clarity?'
];

const styles = `
  @keyframes flipCard {
    0% { transform: rotateY(0deg); opacity: 0.8; }
    50% { transform: rotateY(90deg); opacity: 0.6; }
    100% { transform: rotateY(0deg); opacity: 1; }
  }
  .cc-grid {
    display: grid;
    grid-template-areas:
      ". past above ."
      "left present challenge right"
      ". below future ."
      ". advice external ."
      ". hopesfears outcome .";
    grid-template-columns: 1fr 1fr 1fr 1fr;
    gap: 1rem;
  }
  .cc-present { grid-area: present; }
  .cc-challenge { grid-area: challenge; }
  .cc-past { grid-area: past; }
  .cc-future { grid-area: future; }
  .cc-above { grid-area: above; }
  .cc-below { grid-area: below; }
  .cc-advice { grid-area: advice; }
  .cc-external { grid-area: external; }
  .cc-hopesfears { grid-area: hopesfears; }
  .cc-outcome { grid-area: outcome; }
`;

function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function xorshift32(seed) {
  let x = seed >>> 0 || 0x9e3779b9;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x100000000;
  };
}

function seededShuffle(arr, seed) {
  const copy = arr.slice();
  const rand = xorshift32(seed >>> 0);
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function computeSeed({ cutIndex, knockTimes, userQuestion }) {
  const intervals = knockTimes
    .slice(-3)
    .map((t, i, arr) => (i ? t - arr[i - 1] : 0))
    .reduce((sum, value) => sum + value, 0);
  const qHash = hashString(userQuestion || '');
  let seed = (qHash ^ (cutIndex * 2654435761) ^ Math.floor(intervals)) >>> 0;
  if (seed === 0) seed = 0x9e3779b9;
  return seed >>> 0;
}

function cryptoShuffle(arr) {
  const copy = arr.slice();
  const cryptoObj = typeof window !== 'undefined' && window.crypto;
  for (let i = copy.length - 1; i > 0; i--) {
    const r = cryptoObj?.getRandomValues
      ? cryptoObj.getRandomValues(new Uint32Array(1))[0]
      : Math.floor(Math.random() * 2 ** 32);
    const j = r % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function toAreaClass(position) {
  const map = {
    Present: 'present',
    Challenge: 'challenge',
    Past: 'past',
    Future: 'future',
    Above: 'above',
    Below: 'below',
    Advice: 'advice',
    External: 'external',
    'Hopes/Fears': 'hopesfears',
    Outcome: 'outcome'
  };
  return `cc-${map[position] || 'present'}`;
}

function computeRelationships(cards) {
  if (!cards || cards.length === 0) return [];

  const relationships = [];
  const numbers = cards.map(card => card.number);

  if (numbers.length > 1) {
    const hasSequence = numbers.some((number, index) => index > 0 && Math.abs(number - numbers[index - 1]) === 1);
    if (hasSequence) {
      relationships.push({
        type: 'sequence',
        text: 'Sequential cards suggest a natural progression or journey through connected themes.'
      });
    }
  }

  const pairings = [
    { cards: ['The Fool', 'The Magician'], desc: 'New beginnings (Fool) empowered by manifesting ability (Magician).' },
    { cards: ['Death', 'The Star'], desc: 'Transformation (Death) leading to hope and renewal (Star).' },
    { cards: ['The Tower', 'The Sun'], desc: 'Upheaval (Tower) clearing the path to joy and clarity (Sun).' },
    { cards: ['The Devil', 'The Lovers'], desc: 'Attachment patterns (Devil) affecting relationship choices (Lovers).' },
    { cards: ['The Hermit', 'The High Priestess'], desc: 'Deep introspection (Hermit) accessing inner wisdom (High Priestess).' }
  ];

  const cardNames = cards.map(card => card.name);
  pairings.forEach(pair => {
    if (pair.cards.every(name => cardNames.includes(name))) {
      relationships.push({ type: 'pairing', text: pair.desc });
    }
  });

  if (cards.length >= 3) {
    const firstNum = cards[0].number;
    const lastNum = cards[cards.length - 1].number;
    if (lastNum > firstNum + 5) {
      relationships.push({
        type: 'arc',
        text: 'Your spread shows significant growth from early stages to mastery or completion.'
      });
    }
  }

  return relationships;
}

export default function TarotReading() {
  const [selectedSpread, setSelectedSpread] = useState('single');
  const [reading, setReading] = useState(null);
  const [isShuffling, setIsShuffling] = useState(false);
  const [revealedCards, setRevealedCards] = useState(new Set());
  const [personalReading, setPersonalReading] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [userQuestion, setUserQuestion] = useState('');
  const [analyzingText, setAnalyzingText] = useState('');
  const [hasKnocked, setHasKnocked] = useState(false);
  const [hasCut, setHasCut] = useState(false);
  const [cutIndex, setCutIndex] = useState(Math.floor(MAJOR_ARCANA.length / 2));
  const [dealIndex, setDealIndex] = useState(0);
  const [voiceOn, setVoiceOn] = useState(false);
  const [reflections, setReflections] = useState({});
  const [ambienceOn, setAmbienceOn] = useState(false);

  const ambientRef = useRef(null);
  const knockTimesRef = useRef([]);
  const flipAudioRef = useRef(null);
  const shuffleTimeoutRef = useRef(null);
  const ttsAudioRef = useRef(null);

  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIndex(prev => (prev + 1) % EXAMPLE_QUESTIONS.length);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (typeof Audio === 'undefined') return;
    const flip = new Audio('/sounds/flip.mp3');
    flip.preload = 'auto';
    flipAudioRef.current = flip;
    return () => {
      flip.pause();
    };
  }, []);

  function playFlip() {
    const audio = flipAudioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }

  useEffect(() => {
    if (typeof Audio === 'undefined') return;
    const ambience = new Audio('/sounds/ambience.mp3');
    ambience.loop = true;
    ambience.volume = 0.2;
    ambientRef.current = ambience;
    return () => {
      ambience.pause();
      if (ambientRef.current === ambience) {
        ambientRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const ambience = ambientRef.current;
    if (!ambience) return;
    if (ambienceOn) {
      ambience.play().catch(() => {});
    } else {
      ambience.pause();
    }
  }, [ambienceOn]);

  const relationships = useMemo(() => computeRelationships(reading || []), [reading]);

  function handleKnock() {
    if (typeof performance === 'undefined') return;
    const now = performance.now();
    const recent = knockTimesRef.current.filter(timestamp => now - timestamp < 2000);
    recent.push(now);
    knockTimesRef.current = recent;
    if (recent.length >= 3) {
      setHasKnocked(true);
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate([18, 40, 18]);
      }
    }
  }

  function applyCut() {
    setHasCut(true);
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(12);
    }
  }

  async function speak(text) {
    if (!voiceOn) return;
    if (!text || !text.trim()) return;
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return;

    try {
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
      }

      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });

      if (!response.ok) {
        console.error('TTS error:', response.status);
        return;
      }

      const data = await response.json();
      if (!data?.audio) {
        console.error('No audio field in TTS response');
        return;
      }

      const audio = new Audio(data.audio);
      ttsAudioRef.current = audio;
      await audio.play();
    } catch (err) {
      console.error('Error playing TTS audio:', err);
    }
  }

  function shortLineForCard(card, position) {
    const meaning = card.isReversed ? card.reversed : card.upright;
    const first = meaning.split(',')[0];
    return `${position}: ${card.name} - ${first}.`;
  }

  function dealNext() {
    if (!reading) return;
    if (dealIndex >= reading.length) return;
    const next = dealIndex;
    setRevealedCards(prev => new Set([...prev, next]));
    setDealIndex(next + 1);
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(10);
    }
    playFlip();
    const spreadInfo = SPREADS[selectedSpread];
    const position = spreadInfo.positions[next] || `Position ${next + 1}`;
    void speak(shortLineForCard(reading[next], position));
  }

  function saveReading() {
    if (!reading) return;
    if (typeof localStorage === 'undefined') return;

    const entry = {
      ts: new Date().toISOString(),
      spread: SPREADS[selectedSpread].name,
      question: userQuestion || '',
      cards: reading.map((card, index) => ({
        position: SPREADS[selectedSpread].positions[index] || `Position ${index + 1}`,
        name: card.name,
        number: card.number,
        orientation: card.isReversed ? 'Reversed' : 'Upright'
      })),
      reflections,
      personalReading
    };

    try {
      const key = 'tarot_journal';
      const stored = JSON.parse(localStorage.getItem(key) || '[]');
      const list = Array.isArray(stored) ? stored : [];
      list.unshift(entry);
      if (list.length > 100) {
        list.length = 100;
      }
      localStorage.setItem(key, JSON.stringify(list));
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(12);
      }
    } catch (error) {
      console.error('Failed to save tarot reading', error);
    }
  }

  const shuffle = () => {
    const currentSpread = selectedSpread;

    if (shuffleTimeoutRef.current) {
      clearTimeout(shuffleTimeoutRef.current);
    }

    setIsShuffling(true);
    setReading(null);
    setRevealedCards(new Set());
    setPersonalReading('');
    setAnalyzingText('');
    setIsGenerating(false);
    setDealIndex(0);
    setReflections({});

    if (typeof performance !== 'undefined') {
      const now = performance.now();
      knockTimesRef.current = knockTimesRef.current.filter(timestamp => now - timestamp < 2000);
    }

    const seed = computeSeed({
      cutIndex,
      knockTimes: knockTimesRef.current,
      userQuestion
    });

    const useSeed = hasKnocked || hasCut || (userQuestion && userQuestion.trim());

    shuffleTimeoutRef.current = setTimeout(() => {
      if (selectedSpread !== currentSpread) {
        setIsShuffling(false);
        return;
      }

      const pool = useSeed ? seededShuffle(MAJOR_ARCANA, seed) : cryptoShuffle(MAJOR_ARCANA);
      const count = SPREADS[currentSpread].count;
      const orientationRand = useSeed ? xorshift32((seed ^ 0xa5a5a5a5) >>> 0) : null;
      const cards = pool.slice(0, count).map(card => ({
        ...card,
        isReversed: useSeed ? orientationRand() > 0.5 : Math.random() > 0.5
      }));

      setReading(cards);
      setIsShuffling(false);
    }, 1200);
  };

  useEffect(
    () => () => {
      if (shuffleTimeoutRef.current) {
        clearTimeout(shuffleTimeoutRef.current);
      }
    },
    []
  );

  useEffect(
    () => () => {
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
      }
    },
    []
  );

  const generatePersonalReading = async () => {
    if (!reading || reading.length === 0) {
      setPersonalReading('Please draw your cards before requesting a personalized reading.');
      return;
    }
    if (isGenerating) return;

    setIsGenerating(true);
    setAnalyzingText('');
    setPersonalReading('');

    try {
      const spreadInfo = SPREADS[selectedSpread];

      const cardsInfo = reading.map((card, idx) => {
        const originalCard = MAJOR_ARCANA.find(item => item.name === card.name) || card;
        const meaningText = card.isReversed ? originalCard.reversed : originalCard.upright;
        const position = spreadInfo.positions[idx] || `Position ${idx + 1}`;
        return {
          position,
          card: card.name,
          orientation: card.isReversed ? 'Reversed' : 'Upright',
          meaning: meaningText,
          number: card.number
        };
      });

      const reflectionsText = Object.entries(reflections)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([index, text]) => {
          if (typeof text !== 'string' || !text.trim()) return '';
          const idx = Number(index);
          const position = cardsInfo[idx]?.position || `Position ${idx + 1}`;
          return `${position}: ${text.trim()}`;
        })
        .filter(Boolean)
        .join('\n');

      const cardNames = cardsInfo.map(card => card.card).join(', ');
      setAnalyzingText(`Analyzing: ${cardNames}...\n\nChanneling your personalized reading...`);

      const response = await fetch('/api/tarot-reading', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spreadInfo: { name: spreadInfo.name },
          cardsInfo,
          userQuestion,
          reflectionsText
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('Tarot reading API error:', response.status, errText);
        throw new Error('Failed to generate reading');
      }

      const data = await response.json();
      if (!data?.reading || !data.reading.trim()) {
        throw new Error('Empty reading returned');
      }

      setPersonalReading(data.reading.trim());
    } catch (error) {
      console.error('generatePersonalReading error:', error);
      setPersonalReading('Unable to generate reading at this time. Please try again in a moment.');
    } finally {
      setIsGenerating(false);
      setAnalyzingText('');
    }
  };

  const revealCard = index => {
    if (!reading || !reading[index]) return;
    if (revealedCards.has(index)) return;
    setRevealedCards(prev => new Set([...prev, index]));
    setDealIndex(prev => Math.max(prev, index + 1));
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(10);
    }
    playFlip();
    const spreadInfo = SPREADS[selectedSpread];
    const position = spreadInfo.positions[index] || `Position ${index + 1}`;
    void speak(shortLineForCard(reading[index], position));
  };

  const revealAll = () => {
    if (!reading || reading.length === 0) return;
    const allIndices = new Set(Array.from({ length: reading.length }, (_, index) => index));
    setRevealedCards(allIndices);
    setDealIndex(reading.length);
  };

  return (
    <>
      <style>{styles}</style>
      <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-purple-900 to-indigo-950 text-amber-50">
        <div className="max-w-6xl mx-auto p-8">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="flex items-center justify-center gap-3 mb-4">
              <Moon className="w-8 h-8 text-amber-300" />
              <h1 className="text-5xl font-serif text-amber-200">Mystic Tarot</h1>
              <Sun className="w-8 h-8 text-amber-300" />
            </div>
            <p className="text-amber-100/80 text-lg">Seek guidance from the ancient wisdom of the cards</p>
          </div>

          {/* Spread Selection */}
          <div className="bg-indigo-900/40 backdrop-blur rounded-lg p-6 mb-8 border border-amber-500/20">
            <h2 className="text-xl font-serif text-amber-200 mb-4 flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              Choose Your Spread
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {Object.entries(SPREADS).map(([key, spread]) => (
                <button
                  key={key}
                  onClick={() => {
                    setSelectedSpread(key);
                    setReading(null);
                    setRevealedCards(new Set());
                    setPersonalReading('');
                    setAnalyzingText('');
                    setIsGenerating(false);
                    setDealIndex(0);
                    setReflections({});
                    setHasKnocked(false);
                    setHasCut(false);
                    setCutIndex(Math.floor(MAJOR_ARCANA.length / 2));
                    knockTimesRef.current = [];
                  }}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    selectedSpread === key
                      ? 'bg-amber-500/20 border-amber-500 text-amber-200'
                      : 'bg-indigo-800/40 border-indigo-700/50 text-amber-100/70 hover:border-amber-500/50'
                  }`}
                >
                  <div className="font-serif font-semibold">{spread.name}</div>
                  <div className="text-sm opacity-75">
                    {spread.count} card{spread.count > 1 ? 's' : ''}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Question Input */}
          <div className="bg-indigo-900/40 backdrop-blur rounded-lg p-6 mb-8 border border-amber-500/20">
            <label className="block text-amber-200 font-serif mb-3">Your Question or Intention (Optional)</label>
            <input
              type="text"
              value={userQuestion}
              onChange={event => setUserQuestion(event.target.value)}
              placeholder={EXAMPLE_QUESTIONS[placeholderIndex]}
              className="w-full bg-indigo-950/60 border border-amber-500/30 rounded-lg px-4 py-3 text-amber-100 placeholder-amber-100/40 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition-all"
            />
            <p className="text-amber-100/60 text-sm mt-2">Focus your intention for a more personalized reading</p>
          </div>

          {/* Experience Toggles */}
          <div className="flex flex-wrap items-center gap-4 mb-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={voiceOn}
                onChange={event => {
                  const checked = event.target.checked;
                  setVoiceOn(checked);
                  if (!checked && ttsAudioRef.current) {
                    ttsAudioRef.current.pause();
                    ttsAudioRef.current = null;
                  }
                }}
                className="accent-amber-500"
              />
              <span className="text-amber-100/80 text-sm">Reader voice</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={ambienceOn}
                onChange={event => setAmbienceOn(event.target.checked)}
                className="accent-amber-500"
              />
              <span className="text-amber-100/80 text-sm">Table ambience</span>
            </label>
          </div>

          {/* Ritual: knock and cut */}
          <div className="bg-indigo-900/40 backdrop-blur rounded-lg p-6 mb-6 border border-amber-500/20">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex-1">
                <div className="font-serif text-amber-200 mb-2">Clear the deck</div>
                <button
                  onClick={handleKnock}
                  className="px-4 py-2 rounded-lg border border-amber-500/40 bg-indigo-950/60 hover:bg-indigo-900/60"
                  aria-pressed={hasKnocked}
                  title="Knock 3 times"
                >
                  {hasKnocked ? 'Cleared' : 'Knock 3x'}
                </button>
              </div>
              <div className="flex-1">
                <div className="font-serif text-amber-200 mb-2">Cut the deck</div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={MAJOR_ARCANA.length - 1}
                    value={cutIndex}
                    onChange={event => setCutIndex(parseInt(event.target.value, 10))}
                    className="w-48"
                    aria-label="Cut position"
                  />
                  <button
                    onClick={applyCut}
                    className="px-3 py-2 rounded-lg border border-amber-500/40 bg-indigo-950/60 hover:bg-indigo-900/60"
                    aria-pressed={hasCut}
                  >
                    {hasCut ? 'Cut set' : 'Set cut'}
                  </button>
                </div>
                <div className="text-xs text-amber-100/60 mt-1">Cut at: {cutIndex}</div>
              </div>
            </div>
          </div>

          {/* Shuffle Button */}
          <div className="text-center mb-12">
            <button
              onClick={shuffle}
              disabled={isShuffling}
              className="bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 disabled:opacity-50 text-indigo-950 font-semibold px-8 py-4 rounded-lg shadow-lg transition-all flex items-center gap-3 mx-auto text-lg"
            >
              <RotateCcw className={`w-5 h-5 ${isShuffling ? 'motion-safe:animate-spin' : ''}`} />
              {isShuffling ? 'Shuffling the Cards...' : 'Draw Cards'}
            </button>
          </div>

          {/* Reading Display */}
          {reading && (
            <div className="space-y-8">
              {/* Intention */}
              {userQuestion && (
                <div className="text-center">
                  <p className="text-amber-100/70 text-sm italic">Intention: {userQuestion}</p>
                </div>
              )}

              {/* Spread Name + Guidance */}
              <div className="text-center text-amber-200 font-serif text-2xl mb-2">
                {SPREADS[selectedSpread].name}
              </div>
              {reading.length > 1 && (
                <p className="text-center text-amber-100/50 text-xs mb-4">
                  Reveal in order for a narrative flow, or follow your intuition and reveal randomly
                </p>
              )}

              {/* Reveal All */}
              {revealedCards.size < reading.length && (
                <div className="text-center">
                  <button
                    onClick={revealAll}
                    className="bg-amber-600/30 hover:bg-amber-600/50 border-2 border-amber-500 text-amber-200 font-semibold px-6 py-3 rounded-lg shadow-lg transition-all flex items-center gap-3 mx-auto"
                  >
                    <Star className="w-5 h-5" />
                    Reveal All Cards
                  </button>
                  <p className="text-amber-300/70 text-sm mt-3">
                    {revealedCards.size} of {reading.length} cards revealed
                  </p>
                </div>
              )}

              {reading && revealedCards.size < reading.length && (
                <div className="text-center">
                  <button
                    onClick={dealNext}
                    className="mt-2 bg-amber-600/30 hover:bg-amber-600/50 border-2 border-amber-500 text-amber-200 font-semibold px-6 py-3 rounded-lg shadow-lg transition-all"
                  >
                    Deal next card ({dealIndex + 1}/{reading.length})
                  </button>
                </div>
              )}

              {/* Cards Grid */}
              <div
                className={
                  selectedSpread === 'celtic'
                    ? 'cc-grid'
                    : `grid gap-8 ${
                        reading.length === 1
                          ? 'grid-cols-1 max-w-md mx-auto'
                          : reading.length <= 4
                          ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
                          : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
                      }`
                }
              >
                {reading.map((card, index) => {
                  const isRevealed = revealedCards.has(index);
                  const spreadInfo = SPREADS[selectedSpread];
                  const position = spreadInfo.positions[index] || `Position ${index + 1}`;

                  return (
                    <div
                      key={`${card.name}-${index}`}
                      className={`bg-indigo-900/40 backdrop-blur rounded-lg border border-amber-500/30 overflow-hidden ${
                        selectedSpread === 'celtic' ? toAreaClass(position) : ''
                      }`}
                    >
                      {/* Position Label */}
                      <div className="bg-indigo-950/60 p-3 border-b border-amber-500/20">
                        <h3 className="text-amber-300 font-serif text-center font-semibold">{position}</h3>
                      </div>

                      {/* Card */}
                      <div className="p-4 sm:p-6" style={{ perspective: '1000px' }}>
                        <div
                          onClick={() => !isRevealed && revealCard(index)}
                          onKeyDown={event => {
                            if (!isRevealed && (event.key === 'Enter' || event.key === ' ')) {
                              event.preventDefault();
                              revealCard(index);
                            }
                          }}
                          role="button"
                          aria-label={
                            isRevealed
                              ? `${position}: ${card.name} ${card.isReversed ? 'reversed' : 'upright'}`
                              : `Reveal card for ${position}`
                          }
                          tabIndex={0}
                          className={`cursor-pointer transition-all duration-500 transform ${
                            !isRevealed
                              ? 'hover:bg-indigo-800/30 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-amber-500/50 rounded-lg'
                              : ''
                          }`}
                          style={{
                            transformStyle: 'preserve-3d',
                            animation: isRevealed ? 'flipCard 0.6s ease-out' : 'none'
                          }}
                        >
                          {!isRevealed ? (
                            <div className="text-center py-12">
                              <div className="w-32 h-48 mx-auto rounded-xl shadow-xl border border-amber-400/40 bg-gradient-to-br from-indigo-900 via-purple-900 to-indigo-900 relative overflow-hidden">
                                <div className="absolute inset-0 opacity-[0.15] bg-[radial-gradient(circle_at_top,_#fbbf24,_transparent),radial-gradient(circle_at_bottom,_#60a5fa,_transparent)]" />
                                <div className="absolute inset-3 border border-amber-500/40 rounded-lg" />
                                <div className="relative flex flex-col items-center justify-center h-full text-amber-200">
                                  <Star className="w-8 h-8 mb-1" />
                                  <Moon className="w-6 h-6 mb-1" />
                                  <Star className="w-4 h-4" />
                                  <div className="mt-3 text-[10px] font-serif tracking-wide uppercase opacity-80">
                                    Tap to Reveal
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="transition-all">
                              <div className={card.isReversed ? 'rotate-180' : ''}>
                                <div className="text-center mb-3">
                                  <span className="inline-block bg-amber-500/20 text-amber-300 px-3 py-1 rounded-full text-sm font-semibold border border-amber-500/30">
                                    {card.number}
                                  </span>
                                </div>
                                <h4 className="text-2xl font-serif text-amber-200 text-center mb-4">{card.name}</h4>
                              </div>

                              <div className="text-center mb-4">
                                <span
                                  className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                                    card.isReversed
                                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  }`}
                                >
                                  {card.isReversed ? 'Reversed' : 'Upright'}
                                </span>
                              </div>

                              <div className="bg-indigo-950/60 rounded p-4 border border-amber-500/10">
                                <p className="text-amber-100/90 text-sm leading-relaxed">
                                  {(() => {
                                    const originalCard = MAJOR_ARCANA.find(item => item.name === card.name) || card;
                                    return card.isReversed ? originalCard.reversed : originalCard.upright;
                                  })()}
                                </p>
                              </div>
                              <div className="mt-3">
                                <label className="text-amber-100/70 text-xs block mb-1">What resonates for you?</label>
                                <textarea
                                  value={reflections[index] || ''}
                                  onChange={event =>
                                    setReflections(prev => ({ ...prev, [index]: event.target.value }))
                                  }
                                  rows={2}
                                  className="w-full bg-indigo-950/60 border border-amber-500/20 rounded p-2 text-amber-100/90 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                                  placeholder="Write a sentence or two..."
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Dynamic Insights */}
              {revealedCards.size === reading.length && (
                <div className="bg-indigo-900/40 backdrop-blur rounded-lg p-6 border border-amber-500/30 space-y-4">
                  <h3 className="text-lg font-serif text-amber-200 mb-3 flex items-center gap-2">
                    <Star className="w-5 h-5" />
                    Spread Highlights
                  </h3>
                  <div className="space-y-3 text-amber-100/80 text-sm leading-relaxed">
                    <div className="flex items-start gap-3">
                      <div className="text-amber-300 mt-1">-</div>
                      <div>
                        <span className="font-semibold text-amber-200">Major Arcana:</span>{' '}
                        {reading.length} card{reading.length > 1 ? 's' : ''} drawn
                      </div>
                    </div>
                    {reading.filter(card => card.isReversed).length > 0 && (
                      <div className="flex items-start gap-3">
                        <div className="text-purple-400 mt-1">-</div>
                        <div>
                          <span className="font-semibold text-purple-300">
                            Reversed Cards ({reading.filter(card => card.isReversed).length}):
                          </span>{' '}
                          These suggest internal work, delays, or energies that need to be reconsidered or released.
                        </div>
                      </div>
                    )}
                    {(() => {
                      const spreadInfo = SPREADS[selectedSpread];
                      const startPos = spreadInfo.positions[0] || 'first position';
                      const endPos = spreadInfo.positions[reading.length - 1] || 'final position';
                      return (
                        <div className="flex items-start gap-3">
                          <div className="text-emerald-400 mt-1">-</div>
                          <div>
                            <span className="font-semibold text-emerald-300">Card Sequence:</span>{' '}
                            Notice how the cards flow from {startPos.toLowerCase()} through to {endPos.toLowerCase()},
                            creating a narrative arc.
                          </div>
                        </div>
                      );
                    })()}
                    {relationships.map((relationship, index) => (
                      <div key={index} className="flex items-start gap-3">
                        <div className="text-cyan-400 mt-1">{'>'}</div>
                        <div>
                          <span className="font-semibold text-cyan-300">Card Connection:</span> {relationship.text}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Generate Personal Reading Button */}
              {!personalReading && (
                <div className="text-center">
                  <button
                    onClick={generatePersonalReading}
                    disabled={isGenerating || revealedCards.size < reading.length}
                    className="bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold px-8 py-4 rounded-lg shadow-lg transition-all flex items-center gap-3 mx-auto text-lg"
                  >
                    <Sparkles className={`w-5 h-5 ${isGenerating ? 'motion-safe:animate-pulse' : ''}`} />
                    {isGenerating
                      ? 'Channeling Your Reading...'
                      : revealedCards.size < reading.length
                      ? 'Reveal All Cards First'
                      : 'Get Personalized Reading'}
                  </button>
                  {revealedCards.size < reading.length && (
                    <p className="text-purple-300/60 text-sm mt-3">
                      Reveal all {reading.length} cards to receive your personalized reading
                    </p>
                  )}
                </div>
              )}

              {/* Analyzing Preview */}
              {isGenerating && analyzingText && (
                <div className="max-w-3xl mx-auto text-center">
                  <div className="bg-purple-900/40 backdrop-blur rounded-lg p-6 border border-purple-500/30">
                    <div className="text-purple-200/90 text-sm whitespace-pre-line italic" aria-live="polite">
                      {analyzingText}
                    </div>
                  </div>
                </div>
              )}

              {/* Personal Reading Display */}
              {personalReading && (
                <div className="bg-gradient-to-r from-purple-900/60 to-indigo-900/60 backdrop-blur rounded-lg p-8 border border-amber-500/40 max-w-3xl mx-auto">
                  <h3 className="text-2xl font-serif text-amber-200 mb-4 flex items-center gap-2">
                    <Sparkles className="w-6 h-6" />
                    Your Personal Reading
                  </h3>
                  {userQuestion && (
                    <div className="bg-indigo-950/60 rounded-lg p-4 mb-4 border border-amber-500/20">
                      <p className="text-amber-300/80 text-sm italic">Question: {userQuestion}</p>
                    </div>
                  )}
                  <div className="text-amber-100/90 leading-relaxed space-y-4 whitespace-pre-line">{personalReading}</div>
                  <div className="flex items-center justify-center gap-3 mt-3">
                    <button
                      onClick={() => {
                        void speak(personalReading);
                      }}
                      className="px-4 py-2 rounded-lg border border-amber-500/40 bg-indigo-950/60 hover:bg-indigo-900/60 disabled:opacity-40"
                      disabled={!voiceOn}
                      title={voiceOn ? 'Read aloud' : 'Enable Reader voice above'}
                    >
                      Read this aloud
                    </button>
                  </div>
                  <div className="mt-6 pt-6 border-t border-amber-500/20 flex flex-col gap-3 items-center">
                    <p className="text-amber-200/60 text-xs italic text-center">
                      This reading analyzed card combinations, positional context, emotional arcs, and thematic patterns
                      to provide personalized guidance.
                    </p>
                    <button
                      onClick={saveReading}
                      className="mt-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-indigo-950 font-semibold px-6 py-3 rounded-lg shadow-lg transition-all"
                    >
                      Save to Journal
                    </button>
                    <button
                      onClick={shuffle}
                      className="mt-2 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-indigo-950 font-semibold px-6 py-3 rounded-lg shadow-lg transition-all flex items-center gap-2"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Draw New Reading
                    </button>
                  </div>
                </div>
              )}

              {/* General Guidance */}
              {!personalReading && !isGenerating && (
                <div className="bg-gradient-to-r from-indigo-900/60 to-purple-900/60 backdrop-blur rounded-lg p-6 border border-amber-500/30 max-w-2xl mx-auto">
                  <h3 className="text-xl font-serif text-amber-200 mb-3 flex items-center gap-2">
                    <Star className="w-5 h-5" />
                    Interpretation Guidance
                  </h3>
                  <p className="text-amber-100/80 leading-relaxed">
                    Take a moment to reflect on how these cards relate to your question or situation. The cards work
                    together to tell a story. Consider the overall energy and patterns across the spread. Trust your
                    intuition as you interpret the messages revealed to you.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Initial State */}
          {!reading && !isShuffling && (
            <div className="text-center py-16 px-4">
              <Moon className="w-16 h-16 text-amber-300/50 mx-auto mb-4" />
              <p className="text-amber-100/60 text-lg font-serif">
                Focus on your question, then draw your cards when you're ready
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
