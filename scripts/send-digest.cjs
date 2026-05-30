const https = require('https');

const FEISHU_WEBHOOK = process.env.FEISHU_WEBHOOK;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!FEISHU_WEBHOOK) {
  console.error('错误: FEISHU_WEBHOOK 未设置');
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.error('错误: GEMINI_API_KEY 未设置');
  process.exit(1);
}

const FEEDS = [
  { url: 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json', name: 'X/Twitter', key: 'x' },
  { url: 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-blogs.json', name: '博客', key: 'blogs' },
  { url: 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-podcasts.json', name: '播客', key: 'podcasts' }
];

const TRANSLATE_PROMPT = `You are translating an AI industry digest from English to Chinese.

## Instructions

- Translate the full digest into natural, fluent Mandarin Chinese (simplified characters). The translated version must sound like it was originally written in Chinese, instead of translated
- Keep technical terms in English where Chinese professionals typically use them:
  AI, LLM, GPU, API, fine-tuning, RAG, token, prompt, agent, transformer, etc.
- Keep all proper nouns in English: names of people, companies, products, tools
- Keep all URLs unchanged
- Maintain the same structure and formatting as the English version
- The tone should be professional but conversational
- Never use em-dashes

以下是今天的内容，请翻译：`;

function fetchJSON(url) {
  return new Promise((resolve) => {
    https.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { console.log('解析失败:', url); resolve(null); }
      });
    }).on('error', () => { console.log('请求失败:', url); resolve(null); });
  });
}

function callGemini(text) {
  return new Promise((resolve) => {
    const prompt = TRANSLATE_PROMPT + '\n\n' + text;
    const body = JSON.stringify({
      model: 'deepseek-ai/DeepSeek-V3',
      messages: [
        { role: 'system', content: 'You are a professional translator.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
      max_tokens: 4096
    });

    const options = {
      hostname: 'api.siliconflow.cn',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + GEMINI_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 120000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.choices && json.choices[0] && json.choices[0].message) {
            resolve(json.choices[0].message.content);
          } else if (json.error) {
            console.log('SiliconFlow API 错误:', json.error.message || JSON.stringify(json.error));
            resolve(null);
          } else {
            console.log('SiliconFlow 未知响应:', JSON.stringify(json).substring(0, 500));
            resolve(null);
          }
        } catch (e) { 
          console.log('解析响应失败:', e.message);
          resolve(null); 
        }
      });
    });
    req.on('error', (err) => { 
      console.log('SiliconFlow 请求错误:', err.message);
      resolve(null); 
    });
    req.on('timeout', () => { 
      console.log('SiliconFlow 超时'); 
      resolve(null); 
    });
    req.write(body);
    req.end();
  });
}

function sendToFeishu(message) {
  return new Promise((resolve) => {
    const data = JSON.stringify(message);
    const url = new URL(FEISHU_WEBHOOK);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log('飞书响应状态码:', res.statusCode);
        console.log('飞书响应内容:', body);
        resolve(body);
      });
    });
    req.on('error', (err) => {
      console.log('飞书请求错误:', err.message);
      resolve(null);
    });
    req.write(data);
    req.end();
  });
}

async function main() {
  try {
    console.log('=== 开始执行 ===');
    console.log('FEISHU_WEBHOOK 是否设置:', !!FEISHU_WEBHOOK);
    console.log('GEMINI_API_KEY 是否设置:', !!GEMINI_API_KEY);
    
    console.log('开始获取 Feed...');
    const results = await Promise.all(FEEDS.map(f => fetchJSON(f.url)));

    const allItems = [];
    results.forEach((feed, index) => {
      if (!feed) return;
      const items = feed[FEEDS[index].key];
      if (!items || !Array.isArray(items)) return;
      console.log(FEEDS[index].name + ' 获取到 ' + items.length + ' 条');
      items.forEach(item => allItems.push({ ...item, _source: FEEDS[index].name }));
    });

    console.log('总计获取到 ' + allItems.length + ' 条原始数据');

    if (allItems.length === 0) {
      console.log('没有内容，准备发送空状态通知');
      await sendToFeishu({
        msg_type: 'text',
        content: { text: '今日暂无 AI Builders 更新内容' }
      });
      return;
    }

    // 扁平化数据
    const flatItems = [];
    allItems.forEach(item => {
      if (item._source === 'X/Twitter' && item.tweets && Array.isArray(item.tweets)) {
        item.tweets.forEach(t => {
          flatItems.push({
            title: item.name + ' (@' + item.handle + ')',
            text: t.text,
            url: t.url,
            createdAt: t.createdAt,
            likes: t.likes,
            _source: 'X/Twitter'
          });
        });
      } else {
        flatItems.push({
          title: item.title || item.name || '无标题',
          text: item.content || item.description || '',
          url: item.url,
          createdAt: item.publishedAt,
          _source: item._source
        });
      }
    });

    console.log('扁平化后共 ' + flatItems.length + ' 条');

    flatItems.sort((a, b) => {
      const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tB - tA;
    });

    const items = flatItems.slice(0, 10); // 减少到 10 条，避免太长
    console.log('准备处理 ' + items.length + ' 条内容...');

    // 构建待翻译的文本
    let digestText = '';
    items.forEach((item, i) => {
      digestText += '[' + (i + 1) + '] ' + item.title + '\n';
      digestText += '来源: ' + item._source + '\n';
      if (item.text) digestText += item.text.substring(0, 300) + (item.text.length > 300 ? '...' : '') + '\n';
      if (item.url) digestText += '链接: ' + item.url + '\n';
      digestText += '\n';
    });

    console.log('待翻译文本长度:', digestText.length);

    // 调用 SiliconFlow 翻译
    console.log('正在调用 SiliconFlow 翻译...');
    const translated = await callGemini(digestText);
    console.log('翻译结果:', translated ? '成功 (长度:' + translated.length + ')' : '失败/为空');

    // 构建最终消息
    let displayText = translated || digestText;
    
    // 安全检查
    if (!displayText || displayText.length < 50) {
      console.log('翻译结果异常，使用原文');
      displayText = digestText;
    }

    // 截断到安全长度
    const MAX_LENGTH = 6000;
    if (displayText.length > MAX_LENGTH) {
      displayText = displayText.substring(0, MAX_LENGTH) + '\n\n...（内容已截断，更多请查看原文链接）';
    }
    
    console.log('最终消息长度:', displayText.length);

    // 使用 text 模式发送（最稳定）
    const message = {
      msg_type: 'text',
      content: {
        text: '🤖 AI Builders 每日简报\n\n' + displayText + '\n\n---\n⏰ ' + new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) + ' · 共 ' + flatItems.length + ' 条更新'
      }
    };

    console.log('推送到飞书...');
    const result = await sendToFeishu(message);
    console.log('推送完成，结果:', result);

  } catch (error) {
    console.error('错误:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
