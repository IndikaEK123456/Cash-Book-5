
import { GoogleGenAI } from "@google/genai";

export async function fetchExchangeRates() {
  try {
    // Fix: Always use the named parameter for apiKey initialization
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "Search for the latest USD to LKR and EUR to LKR exchange rates. Return ONLY a JSON object: { \"USD_LKR\": float, \"EUR_LKR\": float }. Use the current market rates.",
      config: {
        tools: [{ googleSearch: {} }],
        // responseMimeType is a hint, model with tools might still return plain text with JSON block
        responseMimeType: "application/json"
      },
    });

    // Fix: guideline says response.text is a property, not a method
    const text = response.text || "{}";
    
    // Model might return Markdown-wrapped JSON if search grounding is used
    let data;
    try {
      data = JSON.parse(text.trim());
    } catch (e) {
      // Robust extraction of JSON block from text
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      data = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    }

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
