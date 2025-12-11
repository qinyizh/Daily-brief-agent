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
2. 渠道：抖音金融科普号，风格是“硬核但通俗”。
`;

const SYSTEM_PROMPT = `
你是一个“毒舌但专业”的金融内容策略专家。你的老板是一个“一人公司”开发者（App开发者+抖音博主）。
你的目标是把枯燥的市场新闻，转化为具有“数据杀伤力”和“幽默感”的爆款策略。

【核心人设】
1. **数据打脸派：** 绝不空谈情绪，必须用数据说话。喜欢用反直觉的数据来反驳大众的错误印象。
2. **比喻大师：** 擅长把复杂的金融概念比作生活中的琐事（如把“通胀”比作“缩水的汉堡”，把“做空”比作“借邻居的车撞烂后再买辆新的还给他”）。

【风格示例】
❌ 差的文案：最近通货膨胀很严重，大家的钱都不值钱了，要学会理财。
✅ 好的文案（你的风格）：CPI 涨了 3.5%，你存银行那点利息就像是在跑步机上冲刺——累得半死但其实在倒退。现在存 1 万块，明年这个时候购买力只剩 9650，相当于你请通胀吃了一顿顶级牛排，它连声谢谢都没说。

【任务】
请阅读提供的即时新闻，并输出一个严格的 JSON 格式报告。
不要输出 Markdown 标记，仅输出纯 JSON 字符串。

JSON Schema:
{
    "top_news_summary": "用犀利语言概括今天最重要的事（带上具体数据）",
    "tiktok_strategy": {
        "title": "一个反直觉、带悬念的抖音爆款标题（20字以内）",
        "hook": "视频前3秒的文案。必须包含一个具体的'打脸数据' + 一个'神比喻'。目的是制造焦虑或打破认知。",
        "key_point": "核心科普知识点（通俗化解释）"
    },
    "app_feature_opportunity": {
        "insight": "这则新闻暴露了用户什么痛点？",
        "action": "我应该优化App的哪个具体功能？（功能建议要具体，比如'添加一个通胀缩水计算器'）"
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
    // C. 写入 Notion (核心修改部分)
    const today = new Date().toISOString().split('T')[0]; // 获取 YYYY-MM-DD

    await notion.pages.create({
      parent: { database_id: process.env.NOTION_DATABASE_ID }, // 指定数据库
      properties: {
        // 这里的 key (如 'Date', 'Summary') 必须和你 Notion 表头的名字一模一样！
        "Date": {
          title: [
            { text: { content: `${today} 金融简报` } }
          ]
        },
        "Status": {
          select: { name: "待办" } // 自动标记为待办
        },
        "Summary": {
          rich_text: [
            { text: { content: report.top_news_summary.substring(0, 2000) } } // 截断以防超长
          ]
        },
        "TikTok Title": {
          rich_text: [
             // 这里把 标题 和 Hook 拼在一起放进去
            { text: { content: `【标题】${report.tiktok_strategy.title}\n【Hook】${report.tiktok_strategy.hook}` } }
          ]
        },
        "App Action": {
          rich_text: [
            { text: { content: report.app_feature_opportunity.action } }
          ]
        }
      }
    });


  } catch (error) {
    console.error("❌ 运行出错:", error);
  }
}

main();

