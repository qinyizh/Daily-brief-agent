import { GoogleGenAI } from "@google/genai";
import { tavily } from "@tavily/core";
import dotenv from "dotenv";

// 加载环境变量
dotenv.config();

// 1. 初始化客户端
// 新版 SDK 会自动读取 process.env.GEMINI_API_KEY，也可以显式传入
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });

// 2. 定义上下文和 Prompt
const MY_CONTEXT = `
我是“一人公司”开发者。
1. 产品：一个iOS订阅制理财App，主打极简记账和可视化。
2. 渠道：抖音金融科普号，风格是“硬核但通俗”。
`;

const SYSTEM_PROMPT = `
你是一个专业的金融内容与产品策略专家。
你的目标是根据最新的市场新闻，为我的“一人公司”提供可执行的决策建议。

我的背景：
${MY_CONTEXT}

任务：
请阅读提供的即时新闻，并输出一个严格的 JSON 格式报告。
不要输出 Markdown 标记，仅输出纯 JSON 字符串。

JSON Schema:
{
    "top_news_summary": "一句话概括今天最重要的事",
    "tiktok_strategy": {
        "title": "一个吸引人的抖音爆款标题",
        "hook": "视频前3秒的文案，必须制造焦虑或好奇",
        "key_point": "核心科普的一个知识点"
    },
    "app_feature_opportunity": {
        "insight": "这则新闻意味着用户会有什么新的记账或理财需求？",
        "action": "我应该优化App的哪个具体功能？"
    }
}
`;

async function main() {
  console.log("🔍 [Agent] 正在全网扫描今日金融热点...");

  try {
    // A. 执行 Tavily 搜索
    const searchResult = await tvly.search("最新金融市场热点 科技股趋势 个人理财新规", {
      search_depth: "advanced",
      max_results: 5,
    });
    
    // 拼接搜索结果
    const contextData = searchResult.results
      .map(r => `[标题] ${r.title}\n[内容] ${r.content}`)
      .join("\n---\n");

    console.log("🧠 [Agent] 正在根据搜索结果生成策略...");

    // B. 调用 Gemini (使用新版 SDK 语法)
    // 注意：gemini-2.5-flash 目前可能尚未公开，这里暂用 gemini-1.5-flash，
    // 如果你有 2.0 或更新模型的权限，可以直接修改 model 字段。
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash", 
      config: {
        systemInstruction: SYSTEM_PROMPT, // 系统提示词放在 config 里
        responseMimeType: "application/json", // 强制 JSON 输出
      },
      contents: [
        {
          role: "user",
          parts: [
            { text: `这是刚刚搜到的今日热点数据，请分析：\n${contextData}` }
          ]
        }
      ]
    });

    // C. 处理结果
    // 新版 SDK 的 response.text() 直接返回生成的文本
    const jsonString = response.text; 
    const report = JSON.parse(jsonString);

    console.log("✅ 简报生成完毕！\n");
    
    // Discord 的 payload 很简单，主内容放在 'content' 字段
    const discordPayload = {
      content: `📅 **${new Date().toLocaleDateString()} 金融行动简报**\n` +
              `----------------------------------\n` +
              `🗞️ **今日热点:** ${report.top_news_summary}\n\n` +
              `🎬 **抖音策略:**\n> **标题:** ${report.tiktok_strategy.title}\n> **Hook:** ${report.tiktok_strategy.hook}\n\n` +
              `📱 **App 机会:**\n${report.app_feature_opportunity.action}`
    };

    await fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordPayload)
    });


  } catch (error) {
    console.error("❌ 运行出错:", error);
  }
}

main();

