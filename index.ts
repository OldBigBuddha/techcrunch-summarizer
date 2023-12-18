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

type Article = {
    readonly title: string;
    readonly link: string;
    readonly pubDate: string;
};

type SummarizedArticle = Article & {
    readonly summary: string | undefined;
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
const client = new OpenAI({ apiKey: Bun.env.OPEN_AI_API_KEY });

async function fetchLastFeed(): Promise<Result<Article[]>> {
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

async function summarize(articles: Article[]): Promise<Result<SummarizedArticle[]>> {
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
    const fetchResult = await fetchLastFeed();
    if (fetchResult.error != null) {
        console.error("Feed Error: failed to fetch atom feed from TechCrunch.");
        console.error(fetchResult.error);
        process.exit(1);
    }

    const summarizeResult = await summarize(fetchResult.data);
    if (summarizeResult.error != null) {
        console.error("Open AI Error: failed to summarize articles");
        console.error(summarizeResult.error);
        process.exit(1);
    }

    console.log(summarizeResult.data);
}

main();