
import { GoogleGenAI } from "@google/genai";

export async function fetchExchangeRates() {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || "" });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "Search for the latest USD to LKR and EUR to LKR exchange rates. Return ONLY a JSON object: { \"USD_LKR\": float, \"EUR_LKR\": float }.",
      config: {
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json"
      },
    });

    const data = JSON.parse(response.text || "{}");
    // Requirement 12: Round up like USD 309.1 as 310
    return {
      usd: data.USD_LKR ? Math.ceil(data.USD_LKR) : 310,
      eur: data.EUR_LKR ? Math.ceil(data.EUR_LKR) : 335
    };
  } catch (error) {
    console.error("Error fetching rates:", error);
    return { usd: 310, eur: 335 };
  }
}
