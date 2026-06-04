const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Valida una foto de reto usando GPT-4 Vision.
 * Retorna { valid: boolean, confidence: number, reason: string, needsVoting: boolean }
 */
async function validateChallengePhoto(photoPath, challengeTitle, challengeDescription) {
  try {
    const imageBuffer = fs.readFileSync(photoPath);
    const base64Image = imageBuffer.toString('base64');
    const mimeType = 'image/jpeg';

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `Sos un validador de retos para un juego llamado "El Gonca". 
Tu trabajo es analizar fotos y determinar si el reto fue cumplido.
Respondé SIEMPRE en formato JSON con esta estructura:
{
  "valid": true/false,
  "confidence": 0.0 a 1.0,
  "reason": "explicación breve"
}
- Si confidence < 0.6, el reto pasa a votación grupal.
- Sé estricto pero justo. La foto debe mostrar evidencia clara del reto.
- Tené en cuenta que las fotos se sacan en el momento, no son preparadas.`,
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Reto: "${challengeTitle}"\nDescripción: "${challengeDescription}"\n\n¿La foto muestra evidencia de que el reto fue cumplido?`,
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      max_tokens: 300,
    });

    const content = response.choices[0].message.content;
    // Parsear JSON de la respuesta
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return {
        valid: result.valid && result.confidence >= 0.6,
        confidence: result.confidence,
        reason: result.reason,
        needsVoting: result.confidence < 0.6 && result.confidence >= 0.3,
      };
    }

    return { valid: false, confidence: 0, reason: 'No se pudo analizar la imagen', needsVoting: true };
  } catch (error) {
    console.error('Error en validación AI:', error.message);
    // Si falla la AI, va a votación
    return { valid: false, confidence: 0, reason: 'Error en validación automática', needsVoting: true };
  }
}

module.exports = { validateChallengePhoto };
