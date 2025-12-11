import { GoogleGenAI } from "@google/genai";
import { tavily } from "@tavily/core";
import { Client } from "@notionhq/client";
import dotenv from "dotenv";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });
const notion = new Client({ auth: process.env.NOTION_API_KEY });

// --- 通用：重试与生成函数 ---
async function generateWithRetry(prompt, systemPrompt, retries = 3) {
  let currentModel = "gemini-2.5-flash"; 
  for (let i = 0; i < retries; i++) {
    try {
      const result = await ai.models.generateContent({
        model: currentModel,
        config: { systemInstruction: systemPrompt, responseMimeType: "application/json" },
        contents: [{ role: "user", parts: [{ text: prompt }] }]
      });
      return JSON.parse(result.text);
    } catch (error) {
      if (error.message.includes("503") || error.message.includes("overloaded")) {
        console.warn(`⚠️ 模型 [${currentModel}] 繁忙，重试中...`);
        if (i === 0) currentModel = "gemini-2.5-flash-preview-09-2025"; 
        await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
      } else { throw error; }
    }
  }
  return null;
}

// ==========================================
// 🔬 流水线 1: 学术研究 (Research)
// ==========================================
async function runResearchFlow() {
  console.log("🔬 [1/2] 正在搜索最新 AI 论文 (arXiv/HuggingFace)...");

    // 1. 搜索词：强制加上 "2025" 和 "December" (针对你的当前时间)
    const searchResult = await tvly.search(
    "latest AI research papers arXiv December 2025 finance reasoning", 
    { search_depth: "advanced", max_results: 7 }
  );
  const context = searchResult.results.map(r => `[Date Check] ${r.published_date || 'Unknown Date'} | [Title] ${r.title} | [Content] ${r.content}`).join("\n");
  // 2. 针对性 Prompt
  const prompt = `
  你是一个学院派的技术顾问。从搜索结果中选出**2025年12月最值得关注的一篇**技术论文或底层模型更新。
  【严格时间过滤】
  1. 必须是 **2025年** (特别是 Late 2025) 发布的。
  2. 如果内容是 2024年或更早的，**直接丢弃**。
  3. 如果搜索结果里全都是旧闻，请返回 null (不要硬编)。
  JSON Schema (如果没找到): { "found": false }
  JSON Schema (如果找到): {
    "found": true,
    "title": "论文标题",
    "url": "链接",
    "summary": "学术摘要（解决了什么技术难题？）",
    "value": "技术价值（对我们开发理财Agent有什么底层启发？比如'提高了记忆力'、'降低了幻觉'）"
  }`;

  const data = await generateWithRetry(`搜集到的论文资讯：\n${context}`, prompt);
  // 3. 逻辑判断：没找到就不写 Notion
  if (!data || data.found === false) {
    console.log("⚠️ 本次搜索未发现 2025 年的高价值新论文，跳过写入。");
    return;
  }

  // 3. 写入 Notion (加上【Paper】前缀)
  await writeToNotion(
    `📑 [Paper] ${data.title}`, 
    data.summary, 
    data.value, // 论文的 Value 填入 Value 列
    "暂无直接应用灵感", // App Inspiration 留空或填默认
    data.url
  );
  console.log("✅ 论文情报已归档！");
}

// ==========================================
// 🚀 流水线 2: 新应用 (Apps)
// ==========================================
async function runAppFlow() {
  console.log("🚀 [2/2] 正在搜索 Product Hunt & GitHub Trending...");

  // 1. 针对性搜索
  const searchResult = await tvly.search(
    "top trending new AI developer tools Product Hunt GitHub released December 2025", 
    { search_depth: "advanced", max_results: 6 }
  );
  const context = searchResult.results.map(r => `[${r.title}] ${r.content}`).join("\n");

  // 2. 针对性 Prompt
  const prompt = `
  你是一个产品猎手。从搜索结果中找出**一个 2025 年新出**最具创意的 AI 新产品或工具。
  【严格时间过滤】
  1. 必须是 **2025年** 新发布或重大更新的。
  2. 拒绝 2023/2024 年的老牌工具（如 AutoGPT, BabyAGI 等旧闻）。
  3. 如果没有 2025 年的新品，返回 { "found": false }。
 JSON Schema (没找到): { "found": false }
  JSON Schema (找到): {
    "found": true,
    "name": "产品名称",
    "url": "链接",
    "feature": "它的核心功能和交互亮点是什么？",
    "inspiration": "我们可以借鉴它的什么交互细节？（比如'它的语音输入动画很棒'）"
  }`;

  const data = await generateWithRetry(`搜集到的产品资讯：\n${context}`, prompt);
  if (!data || data.found === false) {
    console.log("⚠️ 本次搜索未发现 2025 年的新应用，跳过写入。");
    return;
  }

  // 3. 写入 Notion (加上【App】前缀)
  await writeToNotion(
    `🚀 [App] ${data.name}`, 
    data.feature, // App 的 Feature 填入 Summary 列作为介绍
    "参考其交互设计", // Value 列填简单的
    data.inspiration, // 重点：App 的灵感填入 App Inspiration
    data.url
  );
  console.log("✅ 产品情报已归档！");
}

// --- 通用写入函数 ---
async function writeToNotion(title, summary, value, appInspiration, url) {
  const today = new Date().toISOString().split('T')[0];
  let safeUrl = (url && url.startsWith('http')) ? url : null;

  await notion.pages.create({
    parent: { database_id: process.env.NOTION_AI_RESEARCH_DB_ID }, 
    properties: {
      "Name": { title: [{ text: { content: title || "未知条目" } }] },
      "Date": { date: { start: today } },
      "Summary": { rich_text: [{ text: { content: (summary || "").substring(0, 2000) } }] },
      "Value": { rich_text: [{ text: { content: (value || "").substring(0, 2000) } }] },
      // 这里的 App Inspiration 是纯文本，不需要 JSON 格式化了，因为现在只推一个最火的 App
      "App Inspiration": { rich_text: [{ text: { content: (appInspiration || "").substring(0, 2000) } }] },
      "url": { url: safeUrl }
    }
  });
}

// --- 主函数 ---
async function main() {
  try {
    // 串行执行，防止并发导致 API 速率限制
    await runResearchFlow();
    console.log("-------------------");
    await runAppFlow();
    console.log("🎉 所有情报任务完成！");
  } catch (error) {
    console.error("❌ 全局错误:", error);
  }
}

main();