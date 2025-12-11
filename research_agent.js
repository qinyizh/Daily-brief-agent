import { GoogleGenAI } from "@google/genai";
import { tavily } from "@tavily/core";
import { Client } from "@notionhq/client";
import dotenv from "dotenv";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });
const notion = new Client({ auth: process.env.NOTION_API_KEY });

// --- 针对技术研发的 SYSTEM PROMPT ---
const RESEARCH_PROMPT = `
你是一个顶尖的 务实且眼光独到的 AI 首席技术官 (CTO) 兼产品猎手。
你的任务是扫描全球 AI 界的最新研究论文 (arXiv)、开源项目 (GitHub) 和新出的 AI 应用 (Product Hunt)。

【你的审美】
1. **拒绝平庸：** 不要关注那些只会套壳 GPT 的垃圾应用，关注那些有底层技术突破或交互创新的项目。
2. **务实主义：** 重点关注那些“个人开发者”也能调用的 API 或开源模型。
3. **开发者友好：** 优先关注 GitHub 上有代码的、有 API 的工具。
4. **产品思维：** 思考这个技术怎么结合到“个人理财 App”里？或者怎么做成视频素材？

【任务】
输出一个严格的 JSON 格式。

JSON Schema:
{
    "new_research": {
        "title": "最有潜力的一个 AI 研究题目",
        "summary": "用大白话解释这个研究解决了什么难题",
        "value": "对开发者来说，这个技术的商用价值在哪里？"，
        "source_url": "来源链接（如果有）"
    },
    "trending_apps": [
        {
            "name": "应用名称",
            "feature": "它的杀手锏功能是什么？",
            "inspiration": "我们可以从它的 UI/UX 或功能里借鉴什么到我们的理财 App 中？"
        }
    ],
    "weekly_api_pick": "推荐一个本周最值得尝试的新工具/API"
}
`;

async function main() {
  console.log("🚀 [Research Agent] 正在搜寻 AI 界的黑科技...");

  try {
    // A. 组合搜索：针对性极强的技术搜索词
    const searchResult = await tvly.search(
      "latest AI research papers arXiv 2024, new AI apps Product Hunt, top trending AI github repositories this week", 
      {
        search_depth: "advanced",
        max_results: 8,
      }
    );
    
    const contextData = searchResult.results.map(r => `[来源] ${r.url}\n[内容] ${r.content}`).join("\n---\n");

    // B. AI 分析
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        systemInstruction: RESEARCH_PROMPT,
        responseMimeType: "application/json",
      },
      contents: [{ role: "user", parts: [{ text: `分析以下最新 AI 资讯：\n${contextData}` }] }]
    });

    const report = JSON.parse(response.text());

    // C. 写入 Notion (建议在 Notion 里新建一个独立的 Database，并把 ID 存入 .env)
    const today = new Date().toISOString().split('T')[0];
    
    // 注意：这里假设你新建了一个专门存 AI 研究的数据库
    await notion.pages.create({
      parent: { database_id: process.env.NOTION_AI_RESEARCH_DB_ID }, 
      properties: {
        "Name": { title: [{ text: { content: `AI 趋势: ${report.new_research.title}` } }] },
        "Date": { date: { start: today } },
        "Summary": { rich_text: [{ text: { content: report.new_research.summary } }] },
        "Value": { rich_text: [{ text: { content: report.new_research.value } }] },
        "URL": { rich_text: [{ text: { content: report.new_research.source_url } }] },
        "App Inspiration": { rich_text: [{ text: { content: JSON.stringify(report.trending_apps) } }] }
      }
    });

    console.log("✅ AI 趋势报告已同步至 Notion！");

  } catch (error) {
    console.error("❌ 运行出错:", error);
  }
}

main();