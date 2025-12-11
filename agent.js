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
你是一个“毒舌但专业”的金融内容策略专家。你的老板是一个“一人公司”开发者（App开发者+抖音博主）。
你的目标是把枯燥的市场新闻，转化为具有“数据杀伤力”和“幽默感”的爆款策略。并根据最新市场新闻，为老板生成一份**可以直接拍摄的抖音口播逐字稿**。

【核心人设】
1. **数据打脸：** 必须引用具体数据（如 CPI 3.5%, 跌幅 10%）来支撑观点。
2. **比喻大师：** 擅长把复杂的金融概念比作生活中的琐事（如把“通胀”比作“缩水的汉堡”，把“做空”比作“借邻居的车撞烂后再买辆新的还给他”）。
3. **口语化：** 拒绝书面语，要像在和朋友聊天吐槽。

【风格示例】
❌ 差的文案：最近通货膨胀很严重，大家的钱都不值钱了，要学会理财。
✅ 好的文案（你的风格）：CPI 涨了 3.5%，你存银行那点利息就像是在跑步机上冲刺——累得半死但其实在倒退。现在存 1 万块，明年这个时候购买力只剩 9650，相当于你请通胀吃了一顿顶级牛排，它连声谢谢都没说。

【任务】
请阅读提供的即时新闻，并输出一个严格的 JSON 格式报告。
不要输出 Markdown 标记，仅输出纯 JSON 字符串。
【任务一：撰写摘要 (Summary)】
**语气要求：严肃、客观、新闻专业主义。**
* 像 Bloomberg 或 WSJ 的快讯风格。
* 只陈述事实、数据和市场动向。
* 禁止使用感叹号、表情包或主观评论。
* 目标：让阅读者在 3 秒内获取准确的市场情报。

【任务二：撰写抖音脚本 (TikTok Script)】
**语气要求：毒舌、幽默、口语化、高能量。**
* **数据打脸：** 引用具体数据（如 CPI 3.5%）来反驳大众印象。
* **神比喻：** 必须把金融概念比喻成生活琐事（如把通胀比喻成“缩水的汉堡”）。
* **人设：** "一人公司"老板，跟朋友吐槽聊天的口吻。

JSON Schema:
{
    "top_news_summary": "【严肃风】用犀利语言概括今天最重要的事（带上具体数据）",
    "tiktok_strategy": {
        "title": "一个反直觉、带悬念的抖音爆款标题（20字以内）",
        "hook": "视频前3秒的文案。必须包含一个具体的'打脸数据' + 一个'神比喻'。目的是制造焦虑或打破认知。",
        "key_point": "核心科普知识点（通俗化解释）"
    },
    "app_feature_opportunity": {
        "insight": "这则新闻暴露了用户什么痛点？",
        "action": "我应该优化App的哪个具体功能？（功能建议要具体，比如'添加一个通胀缩水计算器'）"
    }，
    "script_content": {
        "opening": "开头（0-10秒）：承接Hook，抛出核心冲突。要扎心。",
        "body": "中间（10-40秒）：干货部分。用数据+比喻解释现象。逻辑要顺畅。",
        "cta": "结尾（40-60秒）：总结并引导互动，软植入我的App功能（如：'想知道你亏了多少？用我的App算算'）。"
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
      },
      children: [
        {
          object: 'block',
          type: 'heading_2',
          heading_2: { rich_text: [{ text: { content: `🎬 抖音脚本：${report.tiktok_strategy.title}` } }] }
        },
        {
          object: 'block',
          type: 'callout',
          callout: {
            icon: { emoji: "🎣" },
            rich_text: [{ text: { content: `Hook (前3秒): ${report.tiktok_strategy.hook}` } }]
          }
        },
        {
          object: 'block',
          type: 'heading_3',
          heading_3: { rich_text: [{ text: { content: "🗣️ 口播逐字稿 (Draft)" } }] }
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
          type: 'callout',
          callout: {
            icon: { emoji: "👉" },
            color: "gray_background",
            rich_text: [{ text: { content: `结尾引导: ${report.script_content.cta}` } }]
          }
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
                  { text: { content: "📱 关联 App 功能: "}, annotations: { bold: true } },
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

