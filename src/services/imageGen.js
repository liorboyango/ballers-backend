/**
 * AI image generation for product shirts.
 * Uses Google's Gemini 2.5 Flash Image model ("nano banana") to render a
 * studio product photo of the soccer jersey from product + team metadata.
 * Returns a raw buffer ready to be streamed to Firebase Storage.
 */
const { GoogleGenAI } = require('@google/genai');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

const DEFAULT_MODEL = 'gemini-2.5-flash-image';

let client = null;
const getClient = () => {
  if (client) return client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AppError(
      'GEMINI_API_KEY is not configured; cannot auto-generate product image.',
      500
    );
  }
  client = new GoogleGenAI({ apiKey });
  return client;
};

const buildPrompt = ({ product, team }) => {
  const teamName = team?.name || 'a soccer team';
  const country = team?.country ? ` (${team.country})` : '';
  const kit = product.kitType || 'home';
  const sponsor = product.sponsor
    ? ` The front of the jersey shows the sponsor logo "${product.sponsor}".`
    : '';
  const season = product.season ? ` Season ${product.season}.` : '';

  return [
    `A photorealistic studio product photo of a ${kit} soccer jersey for ${teamName}${country}.${season}`,
    `${sponsor}`,
    'Front view, jersey laid flat or on an invisible mannequin, centered on a clean pure-white background.',
    'Sharp focus, soft even lighting, professional e-commerce product photography, high detail on fabric texture and team crest.',
    'No human model, no extra props, no text watermark.',
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Generates a shirt image for a product. Returns { buffer, mimeType, ext }.
 * Throws AppError(502) if the model returns no image data.
 */
const generateProductImage = async ({ product, team }) => {
  const ai = getClient();
  const model = process.env.GEMINI_IMAGE_MODEL || DEFAULT_MODEL;
  const prompt = buildPrompt({ product, team });

  logger.info(`Generating product image via ${model} for "${product.name}"`);

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: { responseModalities: ['IMAGE'] },
  });

  const candidate = response?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      const mimeType = part.inlineData.mimeType || 'image/png';
      const ext = mimeType === 'image/jpeg' ? '.jpg' : `.${mimeType.split('/')[1] || 'png'}`;
      return {
        buffer: Buffer.from(part.inlineData.data, 'base64'),
        mimeType,
        ext,
      };
    }
  }

  const textParts = parts.map((p) => p.text).filter(Boolean).join(' ').trim();
  const finishReason = candidate?.finishReason;
  const blockReason = response?.promptFeedback?.blockReason;
  const detail = blockReason
    ? `blocked: ${blockReason}`
    : finishReason && finishReason !== 'STOP'
      ? `finishReason: ${finishReason}`
      : textParts
        ? `model returned text only: "${textParts.slice(0, 200)}"`
        : 'empty response';
  logger.warn(`Image generation produced no image (${detail})`);
  throw new AppError(`Image generation returned no image data (${detail}).`, 502);
};

module.exports = { generateProductImage };
