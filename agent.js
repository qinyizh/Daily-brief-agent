import { GoogleGenAI } from "@google/genai";
import { tavily } from "@tavily/core";
import { Client } from "@notionhq/client";
import dotenv from "dotenv";

// 加载环境变量
dotenv.config();

// 1. 初始化客户端
// 新版 SDK 会自动读取 process.env.GEMINI_API_KEY，也可以显式传入
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });
const notion = new Client({ auth: process.env.NOTION_API_KEY });

// 2. 定义上下文和 Prompt
const MY_CONTEXT = `
我是“一人公司”开发者。
1. 产品：一个iOS订阅制理财App，主打极简记账和可视化。
2. 渠道：抖音金融科普号，风格是“硬核但通俗+幽默比喻”。
`;

const SYSTEM_PROMPT = `
你是一个金融圈的“情报刺客”。
你的任务是扫描杂乱的新闻，提炼出今天最值得关注的 3 个话题，并为老板（一人公司开发者）指明今天的视频方向。

【任务一：情报提炼 (Daily Briefing)】
请从搜索结果中提炼出 **3 个** 最热门、讨论度最高的话题。
格式严格要求：
"今天金融圈最火的3个话题是：1. [话题A]；2. [话题B]；3. [话题C]。建议视频切入点：从‘[话题X]’切入，推广你的App [某功能]。"

【任务二：抖音脚本 (TikTok Script)】
从上面 3 个话题中，挑选**最容易引起焦虑或共鸣**的一个，扩展成口播稿。
* **风格：** 毒舌、数据打脸、神比喻。
* **结构：** Hook (3秒) -> 冲突/干货 -> 结尾引导。

【输出 JSON Schema】
{
    "daily_briefing": "严格按照任务一格式输出的字符串",
    "tiktok_strategy": {
        "title": "反直觉的爆款标题（20字内）",
        "hook": "视频前3秒文案（制造焦虑或好奇）"
    },
    "script_content": {
        "opening": "开头（0-10秒）",
        "body": "中间（10-40秒）",
        "cta": "结尾（40-60秒）"
    },
    "app_feature_opportunity": {
        "action": "App功能建议"
    }
}
`;

async function main() {
  console.log("🔍 [Agent] 正在全网扫描今日金融热点...");

  try {
    // A. 执行 Tavily 搜索
    const searchResult = await tvly.search("美股 ETF 个人理财 AI金融 最新热点 trends 24h", {
      search_depth: "advanced",
      max_results: 7,
    });
    
    // 拼接搜索结果
    const contextData = searchResult.results
      .map(r => `[标题] ${r.title}\n[内容] ${r.content}`)
      .join("\n---\n");

    console.log("🧠 [Agent] 正在根据搜索结果生成策略...");

     // --- 定义支持“自动换模型”的重试函数 ---
    async function generateWithRetry(prompt, retries = 3) {
        // 默认首选模型
        let currentModel = "gemini-2.5-flash"; 
  
        for (let i = 0; i < retries; i++) {
          try {
            // 尝试调用 API
            const result = await ai.models.generateContent({
              model: currentModel,
              config: {
                systemInstruction: SYSTEM_PROMPT,
                responseMimeType: "application/json",
              },
              contents: [{ role: "user", parts: [{ text: `分析这些资讯：\n${prompt}` }] }]
            });
            
            return result; // 成功！直接返回
  
          } catch (error) {
            // 捕获“过载”或“不可用”错误
            if (error.message.includes("503") || error.message.includes("overloaded") || error.status === 503) {
              console.warn(`⚠️ 模型 [${currentModel}] 繁忙，正在进行第 ${i + 1} 次重试...`);
              
              // --- 关键修改：第一次失败后，立刻切换到备用模型 ---
              if (i === 0) { 
                  console.log("🔄 策略切换：尝试调用备用模型 [gemini-2.5-flash-preview-09-2025]...");
                  currentModel = "gemini-2.5-flash-preview-09-2025"; 
              }
              
              // 稍微等待一下 (指数退避: 2s, 4s...)
              await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
            } else {
              // 如果是其他错误 (比如 Key 不对)，直接抛出，不要死循环
              throw error; 
            }
          }
        }
        throw new Error("❌ 所有模型尝试均失败，请检查网络或 API 状态。");
    }
  
      // --- 使用重试函数 ---
    const response = await generateWithRetry(contextData);
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
    // C. 写入 Notion (核心修改部分)
    const today = new Date().toISOString().split('T')[0]; // 获取 YYYY-MM-DD

    await notion.pages.create({
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      // A. 看板属性
      properties: {
        "Date": { title: [{ text: { content: `${today} 市场早报` } }] },
        "Status": { select: { name: "待办" } },
        // 这里写入的就是你想要的“Top 3 + 建议”格式
        "Summary": { rich_text: [{ text: { content: report.daily_briefing } }] },
        "TikTok Title": { 
             rich_text: [{ text: { content: `【标题】${report.tiktok_strategy.title}\n【Hook】${report.tiktok_strategy.hook}` } }] 
        },
        "App Action": { rich_text: [{ text: { content: report.app_feature_opportunity.action } }] }
      },
      // B. 页面正文
      children: [
        {
          object: 'block',
          type: 'callout',
          callout: {
            icon: { emoji: "📢" },
            color: "orange_background",
            // 把最重要的 Briefing 放在最显眼的位置
            rich_text: [
                { 
                    text: { content: "今日情报 Briefing:\n"} , annotations: { bold: true } 
                },
                { 
                    text: { content: report.daily_briefing } 
                }
            ]
          }
        },
        {
            object: 'block',
            type: 'divider',
            divider: {}
        },
        {
          object: 'block',
          type: 'heading_2',
          heading_2: { rich_text: [{ text: { content: `🎬 建议拍摄：${report.tiktok_strategy.title}` } }] }
        },
        {
          object: 'block',
          type: 'callout',
          callout: {
            icon: { emoji: "🎣" },
            rich_text: [{ text: { content: `Hook: ${report.tiktok_strategy.hook}` } }]
          }
        },
        {
          object: 'block',
          type: 'heading_3',
          heading_3: { rich_text: [{ text: { content: "🗣️ 逐字稿 (Draft)" } }] }
        },
        {
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ text: { content: report.script_content.opening } }] }
        },
        {
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ text: { content: report.script_content.body } }] }
        },
        {
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ text: { content: `(结尾): ${report.script_content.cta}` } }] }
        },
        {
            object: 'block',
            type: 'divider',
            divider: {}
        },
        {
            object: 'block',
            type: 'paragraph',
            paragraph: { 
                rich_text: [
                    { text: { content: "📱 关联功能: " } }, // 修复了 annotations 位置
                    { text: { content: report.app_feature_opportunity.action } }
                ] 
            }
        }
      ]
    });

  } catch (error) {
    console.error("❌ 运行出错:", error);
  }
}

main();

