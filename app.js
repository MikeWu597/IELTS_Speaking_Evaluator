const express = require('express');
const app = express();
const path = require('path');
const yaml = require('js-yaml');
const fs = require('fs').promises;
// 读取配置文件
let config;

async function loadConfig() {
  try {
    const configPath = path.join(__dirname, 'config.yml');
    const fileContents = await fs.readFile(configPath, 'utf8');
    config = yaml.load(fileContents);
    if (!config || typeof config !== 'object') {
      throw new Error('Invalid configuration format');
    }

    // 确保 workspace_id 存在
    if (!config.workspace_id) {
      throw new Error('Missing workspace_id in configuration file');
    }
  } catch (error) {
    console.error('Failed to load configuration:', error.message);
    process.exit(1); // 如果配置加载失败，终止程序
  }
}

// 新增函数：根据 name 查询 keyid
async function getKeyIdByName(name) {
  try {
    if (!sqlManager || !sqlManager.connection) {
      throw new Error('Database connection is not initialized.');
    }

    const query = 'SELECT keyid FROM aimemory WHERE name = ?';
    const [rows] = await sqlManager.query(query, [name]);
    console.log('Query result:', rows);
    if (rows && rows.keyid) { // 修改为直接检查 rows 是否存在且包含 keyid 属性
      return rows.keyid;
    } else {
      return null;
    }
  } catch (error) {
    console.error('Error querying keyid:', error.message);
    throw error;
  }
}


// 在这里引入 axios
const axios = require('axios');

(async () => {
  await loadConfig();

  const port = config.port;

  // 添加中间件以解析 JSON 请求体
  app.use(express.json());

  // 静态文件服务
  app.use(express.static(path.join(__dirname, 'public')));

  // 修改 /chat API 来处理用户输入的消息
  app.post('/chat', async (req, res) => {
    const { message, user_prompt_params, biz_params } = req.body; // 添加 biz_params 参数
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    try {

        const apiKey = config.dashscope_key;
        const appId = config.app_id;

        // 构造请求体
        const requestBody = {
            input: {
                prompt: message
            },
            parameters: {
                incremental_output: true
            },
            debug: {}
        };
        
        // 如果提供了 user_prompt_params，则添加到请求体中
        if (user_prompt_params) {
            requestBody.input.user_prompt_params = user_prompt_params;
        }
        
        // 如果提供了 biz_params，则添加到请求体中
        if (biz_params) {
            requestBody.input.biz_params = biz_params;
        }

        // 发起 HTTP 请求
        const response = await axios.post(`https://dashscope.aliyuncs.com/api/v1/apps/${appId}/completion`, requestBody, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'X-DashScope-SSE': 'enable'
            },
            responseType: 'stream' // 用于处理流式响应
        });

        if (response.status !== 200) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // 设置响应头
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // 处理流式响应
        response.data.on('data', (chunk) => {
            const data = chunk.toString();
            const lines = data.split('\n');
            for (const line of lines) {
                if (line.startsWith('data:')) {
                    const eventData = line.substring(5);
                    try {
                        const parsedData = JSON.parse(eventData);
                        res.write(`data: ${JSON.stringify(parsedData)}\n`);
                    } catch (error) {
                        console.error('Error parsing chunk:', error);
                    }
                }
            }
        });

        response.data.on('end', () => {
            res.end();
        });

        response.data.on('error', (error) => {
            console.error('Error processing chat:', error.message);
            res.status(500).json({ error: 'Internal server error' });
        });
    } catch (error) {
        console.error('Error processing chat:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

  // 启动服务器
  app.listen(port, () => {
    console.log(`http://localhost:${port}`);
  });
})();

// 动态导入 node-fetch
let fetch;
(async () => {
  fetch = (await import('node-fetch')).default;
})();
