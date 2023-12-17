import { OpenAI } from "openai";
import { XMLParser } from "fast-xml-parser";

type Article = {
    link: string;
    pubDate: string;
  };
  
type TechCrunchFeed = {
    rss: {
        channel: {
            item: Article[];
        };
    };
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const xmlParser = new XMLParser();
const client = new OpenAI({ apiKey: Bun.env.OPEN_AI_API_KEY });

async function fetchLastFeed(): Promise<Article[]> {
    const yesterdayMs = Date.now() - ONE_DAY_MS;
    try {
        const res = await fetch("https://techcrunch.com/feed/");
        const xml = await res.text();
        const data = xmlParser.parse(xml) as TechCrunchFeed;
        return data.rss.channel.item.filter((item) => {
            const pubDateMs = new Date(item.pubDate).getTime();
            return pubDateMs > yesterdayMs;
        }).map((item) => {
            return {
                link: item.link,
                pubDate: item.pubDate,
            }
        });

    } catch (error) {
        console.error("Failed to fetch TechCrunch Atom Feed.");
        console.error(error);

        process.exit(1);
    }
}

async function summarize(urls: string[]): Promise<string> {
    const body = urls.join("\n");
    const completion = await client.chat.completions.create({
        messages: [
            {
                role: "system",
                content: `
You are an IT-savvy journalist. Give you the IT news and summarize each news in around 100 words.
answer format:
{title marked up as link}
{summary}`
            },              
            {
                role: "user",
                content: body
            }
        ],
        model: "gpt-4-1106-preview",
    });

    return completion.choices[0].message.content!;
}

async function main(): Promise<void> {
    try {
        const articles = await fetchLastFeed();
        const urls = articles.map((article) => article.link );
        const summary = await summarize(urls);
        console.log(summary);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

main();