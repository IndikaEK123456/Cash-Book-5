
import { GoogleGenAI } from "@google/genai";

export async function fetchExchangeRates() {
  try {
    const key = process.env.API_KEY || (window as any).process?.env?.API_KEY;
    if (!key) return { usd: 310, eur: 335 };

    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "Search for the latest USD to LKR and EUR to LKR exchange rates. Return ONLY a JSON object: { \"USD_LKR\": float, \"EUR_LKR\": float }. Use the current market rates for Sri Lanka.",
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const text = response.text || "{}";
    
    let data;
    try {
      data = JSON.parse(text.trim());
    } catch (e) {
      // Robust JSON extraction for Vercel/Gemini grounding edge cases
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      data = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    }

    // Round up as per user request (Requirement 12)
    return {
      usd: data.USD_LKR ? Math.ceil(data.USD_LKR) : 310,
      eur: data.EUR_LKR ? Math.ceil(data.EUR_LKR) : 335
    };
  } catch (error) {
    console.error("Exchange Rate Error:", error);
    return { usd: 310, eur: 335 };
  }
}
