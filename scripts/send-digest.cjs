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
      max_tokens: 8192
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
      timeout: 60000
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
            console.log('SiliconFlow 未知响应:', JSON.stringify(json).substring(0, 200));
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
