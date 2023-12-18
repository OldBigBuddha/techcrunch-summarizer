import { OpenAI } from "openai";
import { XMLParser } from "fast-xml-parser";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

type Result<T> = {
    readonly error: Error;
    readonly data?: undefined;
} | {
    readonly error?: undefined;
    readonly data: T;
};

type Env = {
    readonly OPEN_AI_API_KEY: string;
    readonly DISCORD_WEBHOOK?: string | undefined;
}

type Article = {
    readonly title: string;
    readonly link: string;
    readonly pubDate: string;
};

type SummarizedArticle = Article & {
    readonly summary: string | undefined; // not optional
}
  
type TechCrunchFeed = {
    readonly rss: {
        readonly channel: {
            readonly item: Article[];
        };
    };
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SYSTEM_PROMPT = `You're an IT-savvy journalist. Summarize news in around 100 words without title.`;

const xmlParser = new XMLParser();

function loadEnv(): Result<Env> {
    const { OPEN_AI_API_KEY, DISCORD_WEBHOOK } = process.env;
    if (OPEN_AI_API_KEY === undefined) {
        return {
            error: new Error("lack required envinronment variables"),
        };
    }

    return {
        data: {
            OPEN_AI_API_KEY,
            DISCORD_WEBHOOK,
        }
    }
}

async function fetchYesterdayArticlesFromTechCrunch(): Promise<Result<Article[]>> {
    const yesterdayMs = Date.now() - ONE_DAY_MS;
    try {
        const res = await fetch("https://techcrunch.com/feed/");
        const xml = await res.text();
        const data = xmlParser.parse(xml) as TechCrunchFeed;
        const articles = data.rss.channel.item.filter((item) => {
            const pubDateMs = new Date(item.pubDate).getTime();
            return pubDateMs > yesterdayMs;
        }).map((item) => {
            return {
                title: item.title,
                link: item.link,
                pubDate: item.pubDate,
            }
        });

        return {
            data: articles,
        };

    } catch (error) {
        return {
            error: error as Error,
        }
    }
}

function buildMessageWithAritcleUrl(url: string): ChatCompletionMessageParam[] {
    return [
        {
            role: "system",
            content: SYSTEM_PROMPT,
        },
        {
            role: "user",
            content: url,
        }
    ]
}

async function summarize(apikey: string, articles: Article[]): Promise<Result<SummarizedArticle[]>> {
    const client = new OpenAI({ apiKey: apikey });

    const summarizings = articles.map(async (article) => {
        const completion = await client.chat.completions.create({
            messages: buildMessageWithAritcleUrl(article.link),
            model: "gpt-4-1106-preview",
        });
        return completion.choices[0].message.content!;
    });

    try {
        const summaries = await Promise.allSettled(summarizings);
        const summarizedArticles = summaries.map((summarized, index): SummarizedArticle => {
            if (summarized.status === "rejected") {
                console.debug(`failed to summarize: ${articles[index].title}`);
                return {
                    ...articles[index],
                    summary: undefined,
                }
            }

            return {
                ...articles[index],
                summary: summarized.value
            }
        });

        return {
            data: summarizedArticles
        };
    } catch (error) {
        return {
            error: error as Error,
        }
    }
}

async function main(): Promise<void> {
    const env = loadEnv();
    if (env.error != null) {
        console.error("You need `OPEN_AI_API_KEY` in environment variables.");
        console.error("Please read README.md again carefully!");
        process.exit(1);
    }
    const { OPEN_AI_API_KEY } = env.data;

    const fetchResult = await fetchYesterdayArticlesFromTechCrunch();
    if (fetchResult.error != null) {
        console.error("Feed Error: failed to fetch atom feed from TechCrunch.");
        console.error(fetchResult.error);
        process.exit(1);
    }

    const summarizeResult = await summarize(OPEN_AI_API_KEY, fetchResult.data);
    if (summarizeResult.error != null) {
        console.error("Open AI Error: failed to summarize articles");
        console.error(summarizeResult.error);
        process.exit(1);
    }

    console.log(summarizeResult.data);
}

main();