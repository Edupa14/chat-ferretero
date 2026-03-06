require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!GROQ_API_KEY) {
  console.error('❌ Falta GROQ_API_KEY en el archivo .env');
  process.exit(1);
}

// Groq es compatible con el formato OpenAI
const GROQ_BASE_URL    = 'https://api.groq.com/openai/v1';
const GROQ_MODEL_TEXT  = 'llama-3.3-70b-versatile';
const GROQ_MODEL_VISION = 'meta-llama/llama-4-scout-17b-16e-instruct'; // soporta imágenes

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));
app.use('/public', express.static(path.join(__dirname, 'public')));

const SYSTEM_PROMPT = `Eres un asistente experto de una ferretería en Perú. Tu nombre es "Ferretero", un ayudante amigable y conocedor.

CONTEXTO:
Los clientes llegan con listas o mensajes de WhatsApp que les mandaron maestros de obra, gasfiteros, electricistas o técnicos. Estos mensajes pueden ser texto escrito, texto informal de chat, o FOTOGRAFÍAS de notas manuscritas. El cliente muchas veces no sabe qué productos son exactamente.

TU MISIÓN cuando llega un cliente:
1. Si recibes una imagen: primero lee todo el texto que aparece en ella (puede ser letra manuscrita, una foto de una nota, o una captura de pantalla de chat)
2. Interpretar el lenguaje técnico o coloquial de la lista
3. Identificar cada producto por su nombre comercial en ferreterías peruanas
4. Especificar medida, diámetro, tipo o especificación técnica exacta cuando aplique
5. Indicar la cantidad correcta a pedir
6. Si el término es ambiguo, dar la opción más común usada en Perú
7. Agregar al final un tip breve si hay materiales complementarios importantes que no mencionaron (ej: teflón, pegamento PVC, etc.)

EJEMPLOS de interpretación:
- "cuerpo sellado" = unión de PVC (medida según contexto, generalmente 3/4" o 1/2")
- "cuerpo cortado" = codo de PVC o niple (según contexto)
- "tapa" = tapa de registro o tapón PVC
- "18 huecos" = ladrillo King Kong 18 huecos
- "cemento azul" = cemento Sol (bolsa de 42.5 kg)
- "bls" = bolsas
- "mts" = metros cúbicos (en contexto de agregados)
- "gravilla 1/2" = gravilla de 1/2 pulgada
- "llave de paso" = válvula de paso (especificar diámetro)
- "flotador" = válvula flotadora para tanque de baño

FORMATO DE RESPUESTA:
- Responde en español peruano, cálido y directo
- Lista numerada de productos: número, nombre del producto, especificación, cantidad
- Un párrafo de tip al final si aplica
- No uses asteriscos ni markdown, solo texto plano y emojis moderados
- Máximo 2-3 oraciones de introducción antes de la lista
- Sé preciso pero sin tecnicismos innecesarios para el cliente`;

app.get('/api/ping', (_req, res) => res.json({ demo: false }));

app.post('/api/chat', async (req, res) => {
  const { message, image, history = [] } = req.body;

  if (!message?.trim() && !image) {
    return res.status(400).json({ error: 'Mensaje o imagen requeridos' });
  }

  // Groq sigue el formato OpenAI: content puede ser string o array de partes
  let userContent;
  if (image) {
    userContent = [
      { type: 'image_url', image_url: { url: image } },
      { type: 'text', text: message?.trim() || 'Analiza esta lista de materiales y dime qué productos necesito comprar en la ferretería.' }
    ];
  } else {
    userContent = message.trim();
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: userContent }
  ];

  const model = image ? GROQ_MODEL_VISION : GROQ_MODEL_TEXT;
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`📨 [${new Date().toLocaleTimeString()}] Nueva solicitud`);
  console.log(`   IP     : ${ip}`);
  console.log(`   Tipo   : ${image ? '🖼️  imagen' : '💬 texto'}`);
  console.log(`   Modelo : ${model}`);
  console.log(`\n── PAYLOAD ENVIADO A GROQ ──────────────────────────────`);
  console.log(`   Mensaje: ${message || '(solo imagen)'}`);
  if (image) console.log(`   Imagen : ${image.slice(0, 40)}... [${Math.round(image.length * 0.75 / 1024)} KB]`);
  console.log(`   Historial (${history.length} turnos previos):`);
  history.forEach((m, i) => console.log(`     [${i + 1}] ${m.role}: ${String(m.content).slice(0, 100)}`));
  console.log(`   → Enviando a Groq...`);

  const t0 = Date.now();

  try {
    const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 900,
        temperature: 0.3
      })
    });

    const ms = Date.now() - t0;

    if (!response.ok) {
      const err = await response.json();
      console.error(`   ❌ Groq respondió ${response.status} en ${ms}ms:`, err.error?.message);
      return res.status(response.status).json({ error: err.error?.message || 'Error en Groq API' });
    }

    const data = await response.json();
    const reply = data.choices[0].message.content;
    const usage = data.usage;

    console.log(`\n── RESPUESTA DE GROQ ───────────────────────────────`);
    console.log(`   ✅ OK en ${ms}ms`);
    console.log(`   Tokens : ${usage?.prompt_tokens} prompt + ${usage?.completion_tokens} respuesta = ${usage?.total_tokens} total`);
    console.log(`   Respuesta completa:`);
    console.log(`${reply}`);
    console.log('─'.repeat(60));

    res.json({ reply });
  } catch (err) {
    console.error(`   ❌ Error de conexión (${Date.now() - t0}ms):`, err.message);
    res.status(500).json({ error: 'Error de conexión con Groq' });
  }
});

app.listen(PORT, () => {
  console.log(`\n🛒 Ferretería Asistente corriendo en http://localhost:${PORT}`);
  console.log(`🔑 Groq Key: ${GROQ_API_KEY.slice(0, 8)}...${GROQ_API_KEY.slice(-4)}`);
  console.log(`🤖 Texto: ${GROQ_MODEL_TEXT}`);
  console.log(`🖼️  Visión: ${GROQ_MODEL_VISION}\n`);
});
