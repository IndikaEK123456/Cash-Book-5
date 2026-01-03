
import { GoogleGenAI } from "@google/genai";

/**
 * Fetches latest exchange rates using Gemini with Search Grounding.
 * Optimized for Vercel deployment and Sri Lankan context.
 */
export async function fetchExchangeRates() {
  try {
    // Robust key check for different deployment environments
    const apiKey = process.env.API_KEY || (window as any).process?.env?.API_KEY;
    if (!apiKey) {
      console.warn("API Key not found for Exchange Rates. Using defaults.");
      return { usd: 310, eur: 335 };
    }

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "Search for the current USD to LKR and EUR to LKR exchange rates for today. Return ONLY a JSON object: { \"USD_LKR\": float, \"EUR_LKR\": float }. Use accurate market rates for Sri Lanka.",
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text || "{}";
    
    let data;
    try {
      // Direct parse attempt
      data = JSON.parse(text.trim());
    } catch (e) {
      // Fallback: Extract JSON from potentially markdown-wrapped grounding response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      data = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    }

    // Round up as per business requirement (Requirement 12)
    return {
      usd: data.USD_LKR ? Math.ceil(data.USD_LKR) : 310,
      eur: data.EUR_LKR ? Math.ceil(data.EUR_LKR) : 335
    };
  } catch (error) {
    console.error("Exchange Rate Sync Error:", error);
    // Safe defaults based on typical LKR volatility
    return { usd: 310, eur: 335 };
  }
}
