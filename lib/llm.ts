
import Groq from 'groq-sdk';

const getGroqClient = () => {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        throw new Error('GROQ_API_KEY is missing in environment variables!');
    }
    return new Groq({ apiKey });
};

export async function getAnswer(context: string, question: string) {
    try {
        const groq = getGroqClient();
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

export async function generateSummary(transcript: string) {
    try {
        const groq = getGroqClient();
        const chatCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: `You are an expert AI study assistant. Analyze the provided YouTube video transcript and generate a comprehensive summary and structured study notes.
                    
                    Output Format:
                    # Video Title (Infer if possible, else "Video Summary")
                    
                    ## Summary
                    [Concise summary of the video content]
                    
                    ## Key Concepts
                    - [Concept 1]: [Explanation]
                    - [Concept 2]: [Explanation]
                    
                    ## Study Notes
                    [Detailed bullet points or numbered list]
                    
                    ## Quiz
                    [3 short questions to test understanding]`
                },
                {
                    role: 'user',
                    content: `Transcript:\n${transcript}`,
                },
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.5,
            max_tokens: 2048,
        });

        return chatCompletion.choices[0]?.message?.content || "I couldn't generate a summary.";
    } catch (error) {
        console.error("Groq Summary Error:", error);
        throw new Error("Failed to generate summary from Groq.");
    }
}
