import Groq from 'groq-sdk';

const groqApiKey = process.env.GROQ_API_KEY;
const openRouterApiKey = process.env.OPENROUTER_API_KEY;

const groq = groqApiKey ? new Groq({ apiKey: groqApiKey }) : null;

export async function getAnswer(context: string, question: string) {
    if (!groq) {
        throw new Error("GROQ_API_KEY is missing.");
    }
    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: `You are a helpful AI assistant. Use the following context to answer the user's question accurately.\n\nContext:\n${context}`
                },
                {
                    role: 'user',
                    content: question
                }
            ],
            model: 'llama-3.3-70b-versatile',
        });

        return chatCompletion.choices[0].message.content;
    } catch (error) {
        console.error('Groq Error:', error);
        throw new Error("Failed to get answer from LLM.");
    }
}

export async function generateSummary(transcript: string) {
    const prompt = `You are an expert AI study assistant. Analyze the provided YouTube video transcript and generate a comprehensive summary and structured study notes.
                    
                    Output Format:
                    # Video Summary
                    
                    ## Summary
                    [Concise summary of the video content]
                    
                    ## Key Takeaways
                    - [Key point 1]
                    - [Key point 2]
                    ...
                    
                    ## Detailed Notes
                    ### [Theme/Topic 1]
                    - [Detail/Explanation]
                    - [Example/Analogy]
                    
                    ### [Theme/Topic 2]
                    - [Detail/Explanation]
                    ...
                    
                    ## Glossary (Optional)
                    - **[Term]**: [Definition]
                    
                    Transcript:
                    ${transcript}`;

    // Priority 1: Groq (Fastest)
    if (groq) {
        try {
            console.log("[LLM] Attempting summary with Groq...");
            const completion = await groq.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: 'llama-3.3-70b-versatile',
                temperature: 0.5,
            });
            return completion.choices[0].message.content;
        } catch (e) {
            console.warn("[LLM] Groq failed, falling back if possible:", e);
        }
    }

    // Priority 2: OpenRouter (Robust Fallback)
    if (openRouterApiKey) {
        try {
            console.log("[LLM] Attempting summary with OpenRouter...");
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${openRouterApiKey}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "google/gemini-flash-1.5-exp",
                    messages: [{ role: "user", content: prompt }]
                })
            });
            const data = await response.json();
            return data.choices?.[0]?.message?.content || "No response from OpenRouter";
        } catch (e) {
            console.error("[LLM] OpenRouter failed:", e);
        }
    }

    throw new Error("No LLM provider available. Please check your API keys.");
}
