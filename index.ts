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
    readonly DISCORD_WEBHOOK_URL?: string | undefined;
}

type BaseArticle = {
    readonly title: string;
    readonly link: string;
}

type FeedArticle = {
    readonly pubDate: string;
} & BaseArticle;

type SummarizedArticle = {
    readonly pubDate: Date;
    readonly summary: string | undefined; // not optional
} & BaseArticle;
  
type TechCrunchFeed = {
    readonly rss: {
        readonly channel: {
            readonly item: FeedArticle[];
        };
    };
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SYSTEM_PROMPT = `You're an IT-savvy journalist. Summarize news in around 100 words without title.`;

const xmlParser = new XMLParser();

function loadEnv(): Result<Env> {
    const { OPEN_AI_API_KEY, DISCORD_WEBHOOK_URL } = process.env;
    if (OPEN_AI_API_KEY === undefined) {
        return {
            error: new Error("lack required envinronment variables"),
        };
    }

    return {
        data: {
            OPEN_AI_API_KEY,
            DISCORD_WEBHOOK_URL,
        }
    }
}

async function fetchYesterdayArticlesFromTechCrunch(): Promise<Result<FeedArticle[]>> {
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

async function summarize(apikey: string, articles: FeedArticle[]): Promise<Result<SummarizedArticle[]>> {
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
            const article = articles[index];
            const pubDate = new Date(article.pubDate);
            if (summarized.status === "rejected") {
                console.debug(`failed to summarize: ${article.title}`);
                return {
                    ...article,
                    pubDate: pubDate,
                    summary: undefined,
                }
            }

            return {
                ...article,
                pubDate: pubDate,
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

async function notifySummarizedArticleToDiscord(webhookUrl: string, article: SummarizedArticle): Promise<void> {
    const content = `[${article.title}](${article.link}) - Posted at ${article.pubDate.toLocaleString("ja-JP", { timeZone: "JST" })}\n${article.summary}`;
    await fetch(webhookUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            content: content,
        }),
    });
}

async function main(): Promise<void> {
    const env = loadEnv();
    if (env.error != null) {
        console.error("You need `OPEN_AI_API_KEY` in environment variables.");
        console.error("Please read README.md again carefully!");
        process.exit(1);
    }
    const { OPEN_AI_API_KEY, DISCORD_WEBHOOK_URL } = env.data;

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

    if (DISCORD_WEBHOOK_URL == null) {
        console.warn("No notification to the Discord because the Webhook URL is not set in environment variables.");
        process.exit(0);
    }

    const notifyings = summarizeResult.data.map(async (article) => {
        await notifySummarizedArticleToDiscord(DISCORD_WEBHOOK_URL, article);
    });

    try {
        await Promise.all(notifyings);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

main();