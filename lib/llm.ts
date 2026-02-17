
import Groq from 'groq-sdk';

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY,
});

export async function getAnswer(context: string, question: string) {
    try {
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: `You are a helpful assistant. Use the following context to answer the user's question. If the answer is not in the context, say you don't know.\n\nContext:\n${context}`
                },
                {
                    role: 'user',
                    content: question,
                },
            ],
            model: 'llama-3.3-70b-versatile', // or 'mixtral-8x7b-32768'
            temperature: 0.5,
            max_tokens: 1024,
        });

        return chatCompletion.choices[0]?.message?.content || "I couldn't generate an answer.";
    } catch (error) {
        console.error("LLM Error:", error);
        throw new Error("Failed to get answer from LLM.");
    }
}
