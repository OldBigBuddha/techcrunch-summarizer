import { TargetLanguageCode, Translator } from "deepl-node";
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
    readonly DEEPL_API_AUTH_KEY: string;
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

type DeepLTranslateResponseBody = {
    readonly translations: {
        readonly detected_source_language: string;
        readonly text: string;
    }[];
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SYSTEM_PROMPT = `You're an IT-savvy journalist. Summarize news in around 100 words without title.`;

const xmlParser = new XMLParser();

function loadEnv(): Result<Env> {
    const { OPEN_AI_API_KEY, DEEPL_API_AUTH_KEY, DISCORD_WEBHOOK_URL } = process.env;
    if (OPEN_AI_API_KEY === undefined || DEEPL_API_AUTH_KEY === undefined) {
        return {
            error: new Error("lack required envinronment variables"),
        };
    }

    return {
        data: {
            OPEN_AI_API_KEY,
            DEEPL_API_AUTH_KEY,
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

async function translate(authKey: string, text: string, targetLang: TargetLanguageCode): Promise<Result<string>> {
    // const translator = new Translator(authKey);

    try {
        // see: https://www.deepl.com/ja/docs-api/translate-text/translate-text
        const res = await fetch(
            "https://api-free.deepl.com/v2/translate",
            {
                method: "POST",
                mode: "no-cors",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `DeepL-Auth-Key ${authKey}`,
                },
                body: JSON.stringify({
                    text: [text],
                    target_lang: targetLang,
                }),
            }
        );

        if (res.ok === false) {
            const e = new Error("Failed to translate summary");
            e.name = "DeepL API Error";
            e.cause = await res.json();
            return {
                error: e,
            }
        }

        const translated = await res.json() as DeepLTranslateResponseBody;
        return {
            data: translated.translations[0].text,
        };
    } catch (error) {
        return {
            error: error as Error,
        };
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
    const { OPEN_AI_API_KEY, DEEPL_API_AUTH_KEY, DISCORD_WEBHOOK_URL } = env.data;

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

    const translatingSummaries = summarizeResult.data.map(async (article): Promise<SummarizedArticle> => {
        if (article.summary == null) {
            return article;
        }

        const translateResult = await translate(DEEPL_API_AUTH_KEY, article.summary, "ja");
        if (translateResult.error != null) {
            console.error(translateResult.error);
            return article;
        }

        return {
            ...article,
            summary: translateResult.data,
        }
    });

    const translatedSummaries = await Promise.all(translatingSummaries);

    console.log(translatedSummaries);

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