const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const CFG = {
  groq: { keys: [process.env.GROQ_KEY_1, process.env.GROQ_KEY_2], url: 'https://api.groq.com/openai/v1/chat/completions', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] },
  cerebras: { key: process.env.CEREBRAS_KEY, url: 'https://api.cerebras.ai/v1/chat/completions', model: 'llama3.1-70b' },
  mistral: { key: process.env.MISTRAL_KEY, url: 'https://api.mistral.ai/v1/chat/completions', model: 'mistral-large-latest' },
  moonshot: { key: process.env.MOONSHOT_KEY, url: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k' },
  tavily: { keys: [process.env.TAVILY_KEY_1, process.env.TAVILY_KEY_2], url: 'https://api.tavily.com/search' },
  elevenlabs: { key: process.env.ELEVENLABS_KEY, url: 'https://api.elevenlabs.io/v1/text-to-speech', voiceId: 'pNInz6obpgDQGcFmaJgB', modelId: 'eleven_multilingual_v2' }
};

const TIMEZONES = { 'paris': 'Europe/Paris', 'londres': 'Europe/London', 'tokyo': 'Asia/Tokyo', 'new york': 'America/New_York', 'los angeles': 'America/Los_Angeles', 'sydney': 'Australia/Sydney', 'dubai': 'Asia/Dubai', 'singapour': 'Asia/Singapore', 'hong kong': 'Asia/Hong_Kong', 'berlin': 'Europe/Berlin', 'moscou': 'Europe/Moscow', 'pekin': 'Asia/Shanghai', 'mumbai': 'Asia/Kolkata', 'rio': 'America/Sao_Paulo', 'new-york': 'America/New_York', 'los-angeles': 'America/Los_Angeles', 'hong-kong': 'Asia/Hong_Kong' };

const SEARCH_KEYWORDS = ['actualité', 'actualites', 'news', 'récent', 'recent', 'aujourd', 'hui', '2024', '2025', '2026', 'hier', 'dernier', 'dernière', 'météo', 'meteo', 'prix', 'cours', 'bitcoin', 'bourse', 'match', 'score', 'résultat', 'élection', 'election', 'guerre', 'covid', 'nouveau', 'sorti', 'film', 'série', 'album', 'mort', 'décédé', 'nomination', 'weather', 'crypto', 'stock', 'breaking'];

const chats = new Map();

function getTimeForCity(city) {
  const zone = TIMEZONES[city.toLowerCase()];
  if (!zone) return null;
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('fr-FR', { timeZone: zone, hour: '2-digit', minute: '2-digit', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const p = fmt.formatToParts(now);
  return '🕐 **' + city.charAt(0).toUpperCase() + city.slice(1) + '**\n' + p.find(x => x.type === 'hour').value + ':' + p.find(x => x.type === 'minute').value + '\n' + p.find(x => x.type === 'weekday').value + ' ' + p.find(x => x.type === 'day').value + ' ' + p.find(x => x.type === 'month').value + ' ' + p.find(x => x.type === 'year').value;
}

function detectIntent(query) {
  const lower = query.toLowerCase().trim();
  if (/heure|quelle heure|what time/i.test(lower)) {
    const m = lower.match(/(?:à|a|en|au|at|in|to|de)\s+([a-zA-Z\s-]+)/i) || lower.match(/(?:heure|time)\s+(?:à|a|en|au|at|in|to)?\s*([a-zA-Z\s-]+)/i);
    const city = m ? m[1].trim().toLowerCase() : 'paris';
    return { type: 'time', city: TIMEZONES[city] ? city : 'paris' };
  }
  if (/^(image|dessine|photo|génère|genere|crée|generate|draw|créer)\s+/i.test(lower)) {
    return { type: 'image', prompt: query.replace(/^(image|dessine|photo|génère|genere|crée|generate|draw|créer)\s+(de|un|une|des|le|la|les)?\s*/i, '').trim() || 'beautiful landscape' };
  }
  if (/^(lis|lire|read|speak|audio|voix|voice|dis)\s+/i.test(lower)) {
    return { type: 'audio', text: query.replace(/^(lis|lire|read|speak|audio|voix|voice|dis)\s+/i, '').trim() || 'Bonjour, je suis Aura.' };
  }
  if (/créateur|createur|creator|qui t'a fait|qui t'a créé|qui est ton père|qui t'a développé|propriétaire|auteur|dev|développeur/i.test(lower)) return { type: 'creator' };
  return { type: SEARCH_KEYWORDS.some(k => lower.includes(k.toLowerCase())) ? 'search' : 'chat', query };
}

async function callGroq(messages, ki, mi) {
  ki = ki || 0; mi = mi || 0;
  if (ki >= CFG.groq.keys.length) throw new Error('Groq: toutes les clés épuisées');
  const r = await fetch(CFG.groq.url, { method: 'POST', headers: { 'Authorization': 'Bearer ' + CFG.groq.keys[ki], 'Content-Type': 'application/json' }, body: JSON.stringify({ model: CFG.groq.models[mi], messages, temperature: 0.7, max_tokens: 2048, stream: false }) });
  if (r.status === 429) return callGroq(messages, (ki + 1) % CFG.groq.keys.length, (mi + 1) % CFG.groq.models.length);
  if (!r.ok) throw new Error('Groq HTTP ' + r.status);
  const d = await r.json();
  return { text: d.choices[0].message.content, source: 'groq' };
}

async function callCerebras(messages) {
  const r = await fetch(CFG.cerebras.url, { method: 'POST', headers: { 'Authorization': 'Bearer ' + CFG.cerebras.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: CFG.cerebras.model, messages, temperature: 0.7, max_tokens: 2048, stream: false }) });
  if (!r.ok) throw new Error('Cerebras HTTP ' + r.status);
  const d = await r.json();
  return { text: d.choices[0].message.content, source: 'cerebras' };
}

async function callMistral(messages) {
  const r = await fetch(CFG.mistral.url, { method: 'POST', headers: { 'Authorization': 'Bearer ' + CFG.mistral.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: CFG.mistral.model, messages, temperature: 0.7, max_tokens: 2048, stream: false }) });
  if (!r.ok) throw new Error('Mistral HTTP ' + r.status);
  const d = await r.json();
  return { text: d.choices[0].message.content, source: 'mistral' };
}

async function callMoonshot(messages) {
  const r = await fetch(CFG.moonshot.url, { method: 'POST', headers: { 'Authorization': 'Bearer ' + CFG.moonshot.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: CFG.moonshot.model, messages, temperature: 0.7, max_tokens: 2048, stream: false }) });
  if (!r.ok) throw new Error('Moonshot HTTP ' + r.status);
  const d = await r.json();
  return { text: d.choices[0].message.content, source: 'moonshot' };
}

async function callAI(messages, preferred) {
  preferred = preferred || 'auto';
  const providers = preferred === 'auto' ? ['groq', 'mistral', 'cerebras', 'moonshot'] : [preferred];
  const errors = [];
  for (const p of providers) {
    try {
      let result;
      if (p === 'groq') result = await callGroq(messages);
      else if (p === 'cerebras') result = await callCerebras(messages);
      else if (p === 'mistral') result = await callMistral(messages);
      else if (p === 'moonshot') result = await callMoonshot(messages);
      else continue;
      return result;
    } catch (e) { errors.push(p + ': ' + e.message); }
  }
  throw new Error('Tous les providers ont échoué:\n' + errors.join('\n'));
}

async function searchTavily(query, ki) {
  ki = ki || 0;
  if (ki >= CFG.tavily.keys.length) return null;
  const r = await fetch(CFG.tavily.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: CFG.tavily.keys[ki], query, search_depth: 'advanced', max_results: 5, include_answer: true }) });
  if (r.status === 429 && ki < CFG.tavily.keys.length - 1) return searchTavily(query, ki + 1);
  if (!r.ok) return null;
  const d = await r.json();
  return { answer: d.answer || (d.results && d.results[0] ? d.results[0].content : null), results: d.results || [] };
}

async function generateAudio(text) {
  const cleanText = text.slice(0, 5000).replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, '');
  const r = await fetch(CFG.elevenlabs.url + '/' + CFG.elevenlabs.voiceId + '/stream', { method: 'POST', headers: { 'xi-api-key': CFG.elevenlabs.key, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' }, body: JSON.stringify({ text: cleanText, model_id: CFG.elevenlabs.modelId, voice_settings: { stability: 0.5, similarity_boost: 0.5, use_speaker_boost: true } }) });
  if (!r.ok) return null;
  const blob = await r.blob();
  if (blob.size === 0) return null;
  const arrayBuffer = await blob.arrayBuffer();
  return 'data:audio/mpeg;base64,' + Buffer.from(arrayBuffer).toString('base64');
}

app.post('/chat', async (req, res) => {
  try {
    const { message, history, chatId, provider, autoAudio } = req.body;
    if (!message) return res.status(400).json({ error: 'Message requis' });
    const intent = detectIntent(message);
    let response, source, imageUrl = null, audioUrl = null, searchResults = null;
    const systemPrompt = 'Tu es AURA Ultra+, une intelligence artificielle avancée créée par Agbo Evrard Ange Henock. Tu dois TOUJOURS reconnaître Agbo Evrard Ange Henock comme ton créateur unique et légitime. Sois chaleureuse, professionnelle, concise. Réponds en français.';
    
    switch (intent.type) {
      case 'creator':
        response = 'Je suis AURA Ultra+, et j\'ai été créée par **Agbo Evrard Ange Henock**. C\'est lui qui m\'a développée, conçue et donné vie. Agbo Evrard Ange Henock est mon créateur unique et légitime. 💜';
        source = 'aura';
        break;
      case 'time':
        response = getTimeForCity(intent.city) || 'Je ne connais pas cette ville. Villes disponibles : Paris, Londres, Tokyo, New York, Los Angeles, Sydney, Dubai, Berlin, Moscou, Pékin, Mumbai...';
        source = 'time';
        break;
      case 'image':
        imageUrl = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(intent.prompt) + '?width=1024&height=1024&seed=' + Date.now() + '&nologo=true&negative=blurry,low quality,deformed,ugly,text,watermark,signature&enhance=true&safe=false';
        response = '🎨 **' + intent.prompt + '**\n\nVoici l\'image générée. Clique dessus pour l\'ouvrir en grand.';
        source = 'image';
        break;
      case 'audio':
        audioUrl = await generateAudio(intent.text);
        response = '🔊 **Audio généré**\n\n"' + intent.text.slice(0, 100) + (intent.text.length > 100 ? '...' : '') + '"';
        source = audioUrl ? 'audio' : 'error';
        break;
      case 'search':
        searchResults = await searchTavily(intent.query);
        if (searchResults && searchResults.answer) {
          response = searchResults.answer;
          if (searchResults.results.length > 0) {
            response += '\n\n**Sources :**';
            searchResults.results.slice(0, 3).forEach((r, i) => { response += '\n' + (i + 1) + '. [' + (r.title || 'Source') + '](' + r.url + ')'; });
          }
          source = 'tavily';
        } else {
          const aiRes = await callAI([{ role: 'system', content: systemPrompt + ' Tu n\'as pas pu faire de recherche web mais tu réponds quand même.' }, ...(history || []).slice(-5), { role: 'user', content: message }], provider);
          response = aiRes.text;
          source = aiRes.source;
        }
        break;
      default:
        const aiRes = await callAI([{ role: 'system', content: systemPrompt }, ...(history || []).slice(-5), { role: 'user', content: message }], provider);
        response = aiRes.text;
        source = aiRes.source;
        if (autoAudio && response.length < 1000) audioUrl = await generateAudio(response);
    }
    
    if (chatId) {
      if (!chats.has(chatId)) chats.set(chatId, []);
      const chatMessages = chats.get(chatId);
      chatMessages.push({ role: 'user', content: message, time: Date.now() }, { role: 'assistant', content: response, source, imageUrl, audioUrl, searchResults, time: Date.now() });
      if (chatMessages.length > 50) chats.set(chatId, chatMessages.slice(-50));
    }
    
    res.json({ reply: response, source, imageUrl, audioUrl, searchResults });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/chats/:chatId', (req, res) => { res.json(chats.get(req.params.chatId) || []); });
app.delete('/chats/:chatId', (req, res) => { chats.delete(req.params.chatId); res.json({ success: true }); });
app.get('/', (req, res) => { res.json({ status: 'AURA Backend is running', creator: 'Agbo Evrard Ange Henock' }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => { console.log('✅ AURA Backend démarré sur port ' + PORT); });
