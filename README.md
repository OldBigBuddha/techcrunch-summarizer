# TechCrunch news summarizer via GPT-4 Turbo

The "TechCrunch News Summarizer" implemented in TypeScript is a project designed to automatically fetch and summarize articles from TechCrunch using OpenAI's GPT-4 Turbo model. This tool aims to provide quick, concise summaries of the latest technology news, making it easier for users to stay informed without needing to read entire articles. It leverages the advanced natural language processing capabilities of GPT-4 Turbo to generate accurate and relevant summaries, offering a time-efficient solution for consuming news content.

## Requirements

* [bun](https://bun.sh/)
* [Open AI API Key](https://platform.openai.com/docs/overview)
* [Charging more than $1 for OpenAI](https://help.openai.com/en/articles/7102672-how-can-i-access-gpt-4) 

## How to setup and run

To create `.env` refered with `.env.example`:

```sh
$ echo 'OPEN_AI_API_KEY="<your open ai api key>"' > .env
```

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.0.14. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
